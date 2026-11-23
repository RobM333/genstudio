// Builds a full ad in the browser, one short fal job at a time, so nothing hits
// the hosting time limit: each scene (from the user's product photo when given),
// the end card, the voiceover lines and the music, then one join and one mix.
// Progress is saved on the item, so a closed page carries on where it stopped.

import { endCardPrompt, endCardSeconds, SCENE_SECONDS, scenePrompt, type AdBrief, type AdPlan } from "@/lib/adplan";
import { post, waitFor } from "./storyRunner";

export type AdClip = { url?: string; frame?: string; status: "waiting" | "working" | "done" | "failed"; error?: string };

export type AdJob = {
  brief: AdBrief;
  plan: AdPlan;
  refs?: { url: string; kind: string; token: string }[];
  clips: AdClip[]; // one per scene
  voices: (string | undefined)[]; // one per scene, then the end card's
  voiceFor: string[]; // the line each voice clip was made from, so changed lines are re-read
  cardImage?: string;
  cardClip?: string;
  cardFor?: string; // headline|tagline the card was made with
  musicUrl?: string;
  musicFor?: string;
  joinedUrl?: string;
  step?: string;
  sceneModelId: string; // text-to-video
  animateModelId: string; // image-to-video, used with the product photo
};

export const AD_T2V = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";
export const AD_I2V = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";

export function newAdJob(brief: AdBrief, plan: AdPlan, refs?: AdJob["refs"]): AdJob {
  return {
    brief,
    plan,
    refs: refs?.length ? refs : undefined,
    clips: plan.scenes.map(() => ({ status: "waiting" })),
    voices: [],
    voiceFor: [],
    sceneModelId: AD_T2V,
    animateModelId: AD_I2V,
  };
}

/** The voiceover lines in order: each scene, then the end card. */
export function voiceLines(plan: AdPlan): string[] {
  return [...plan.scenes.map((s) => s.voice), plan.endCard.voice];
}

async function sceneFrame(job: AdJob, i: number, aspectRatio: string): Promise<string> {
  const res = await post("/api/generate", {
    modelId: "fal-ai/nano-banana/edit",
    prompt: `Opening frame of a video ad scene. ${scenePrompt(job.plan, i)}`.slice(0, 1990),
    aspectRatio,
    enhance: false,
    purpose: "keyframe",
    refs: job.refs,
  });
  return waitFor(res.modelId ?? "fal-ai/nano-banana/edit", res);
}

async function sceneClip(job: AdJob, i: number, aspectRatio: string, frame?: string): Promise<string> {
  const modelId = frame ? job.animateModelId : job.sceneModelId;
  const res = await post("/api/generate", {
    modelId,
    prompt: scenePrompt(job.plan, i),
    aspectRatio,
    duration: SCENE_SECONDS,
    sound: false,
    enhance: true,
    sourceUrl: frame,
    purpose: frame ? "animate" : undefined,
  });
  return waitFor(modelId, res);
}

async function cardImage(job: AdJob, aspectRatio: string): Promise<string> {
  const withRefs = Boolean(job.refs?.length);
  const modelId = withRefs ? "fal-ai/nano-banana/edit" : "fal-ai/nano-banana";
  const res = await post("/api/generate", {
    modelId,
    prompt: endCardPrompt(job.plan, withRefs),
    aspectRatio,
    enhance: false,
    refs: withRefs ? job.refs : undefined,
  });
  return waitFor(res.modelId ?? modelId, res);
}

async function tool(body: Record<string, unknown>, fallbackModel: string): Promise<string> {
  const res = await post("/api/tool", body);
  if (res.status === "COMPLETED") return res.url ?? "";
  return waitFor(res.modelId ?? fallbackModel, res);
}

/**
 * Makes whatever is still missing, in order, saving after each step.
 * Pieces that are already made (and still match the plan) are never paid for again.
 */
export async function buildAd(job: AdJob, aspectRatio: string, save: (j: AdJob, patch?: { stepStartedAt?: number; jobModelId?: string }) => void): Promise<{ url: string; hasAudio: boolean }> {
  const plan = job.plan;
  const n = plan.scenes.length;
  const step = (label: string, modelId: string) => {
    job.step = label;
    save(job, { stepStartedAt: Date.now(), jobModelId: modelId });
  };

  for (let i = 0; i < n; i++) {
    const clip = job.clips[i] ?? (job.clips[i] = { status: "waiting" });
    if (clip.url) continue;
    clip.status = "working";
    clip.error = undefined;
    try {
      if (job.refs?.length && !clip.frame) {
        step(`Scene ${i + 1} of ${n}: placing your product`, "fal-ai/nano-banana/edit");
        clip.frame = await sceneFrame(job, i, aspectRatio);
      }
      step(`Scene ${i + 1} of ${n}`, clip.frame ? job.animateModelId : job.sceneModelId);
      clip.url = await sceneClip(job, i, aspectRatio, clip.frame);
      clip.status = "done";
    } catch (e) {
      clip.status = "failed";
      clip.error = (e as Error).message;
      save(job);
      throw e;
    }
    save(job);
  }

  const cardKey = `${plan.endCard.headline}|${plan.endCard.tagline}`;
  if (!job.cardClip || job.cardFor !== cardKey) {
    if (!job.cardImage || job.cardFor !== cardKey) {
      step("Designing the end card", "fal-ai/nano-banana");
      job.cardImage = await cardImage(job, aspectRatio);
    }
    step("Finishing the end card", "fal-ai/ffmpeg-api/compose");
    job.cardClip = await tool({ tool: "still", imageUrl: job.cardImage, seconds: endCardSeconds(plan.seconds) }, "fal-ai/ffmpeg-api/compose");
    job.cardFor = cardKey;
    job.joinedUrl = undefined;
    save(job);
  }

  if (!job.joinedUrl) {
    step("Joining the scenes", "fal-ai/ffmpeg-api/merge-videos");
    job.joinedUrl = await tool({ tool: "merge", urls: [...job.clips.map((c) => c.url!), job.cardClip] }, "fal-ai/ffmpeg-api/merge-videos");
    save(job);
  }

  // Voiceover: one clip per line, so each lands on its own scene.
  const lines = voiceLines(plan);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    const key = `${plan.voice}|${lines[i]}`;
    if (job.voices[i] && job.voiceFor[i] === key) continue;
    step(`Recording the voiceover (${i + 1} of ${lines.length})`, "fal-ai/elevenlabs/tts/turbo-v2.5");
    job.voices[i] = (await tool({ tool: "voice", text: lines[i], voice: plan.voice }, "fal-ai/elevenlabs/tts/turbo-v2.5")) || undefined;
    job.voiceFor[i] = key;
    save(job);
  }

  if (!job.musicUrl || job.musicFor !== plan.music) {
    step("Making the music", "cassetteai/music-generator");
    job.musicUrl = (await tool({ tool: "music", prompt: plan.music, seconds: plan.seconds }, "cassetteai/music-generator")) || undefined;
    job.musicFor = plan.music;
    save(job);
  }

  const voices = lines
    .map((_, i) => ({ url: job.voices[i], at: i * SCENE_SECONDS + 0.3, seconds: (i < n ? SCENE_SECONDS : endCardSeconds(plan.seconds)) - 0.4 }))
    .filter((v) => v.url);
  const hasAudio = voices.length > 0 || Boolean(job.musicUrl);
  if (!hasAudio) return { url: job.joinedUrl!, hasAudio: false };
  step("Mixing voiceover and music", "fal-ai/ffmpeg-api/compose");
  const url = await tool({ tool: "mix", videoUrl: job.joinedUrl, voices, musicUrl: job.musicUrl, seconds: plan.seconds }, "fal-ai/ffmpeg-api/compose");
  job.step = undefined;
  return { url, hasAudio: true };
}

/**
 * A new version of an ad after the plan changed: scenes whose picture didn't
 * change are kept, so only the changed parts are made (and paid for) again.
 */
export function changedAdJob(old: AdJob, plan: AdPlan): { job: AdJob; scenes: number; card: boolean; voiceChars: number; music: boolean } {
  const lookSame = old.plan.look === plan.look;
  let scenes = 0;
  const clips: AdClip[] = plan.scenes.map((s, i) => {
    const before = old.plan.scenes[i];
    const same = lookSame && before && before.visual === s.visual && before.camera === s.camera && old.clips[i]?.url;
    if (same) return { ...old.clips[i] };
    scenes++;
    return { status: "waiting" };
  });
  const card = old.plan.endCard.headline !== plan.endCard.headline || old.plan.endCard.tagline !== plan.endCard.tagline || !lookSame;
  const lines = voiceLines(plan);
  const voiceChars = lines.reduce((n, l, i) => n + (old.voiceFor[i] === `${plan.voice}|${l}` ? 0 : l.length), 0);
  const music = old.musicFor !== plan.music;
  const job: AdJob = {
    ...old,
    plan,
    clips,
    voices: [...old.voices],
    voiceFor: [...old.voiceFor],
    cardImage: card ? undefined : old.cardImage,
    cardClip: card ? undefined : old.cardClip,
    cardFor: card ? undefined : old.cardFor,
    joinedUrl: scenes > 0 || card ? undefined : old.joinedUrl,
    step: undefined,
  };
  return { job, scenes, card, voiceChars, music };
}
