// Builds a full ad in the browser, one short fal job at a time, so nothing hits
// the hosting time limit: each scene (from the user's product photo when given),
// the end card, the voiceover lines and the music, then one join and one mix.
// The voice is recorded first. A scene whose line is said on screen is then made
// from that exact recording, so the lips match the words; narrator scenes are
// filmed with nobody talking and the voice laid over them.
// Progress is saved on the item, so a closed page carries on where it stopped.

import { endCardPrompt, endCardSeconds, lineSeconds, maxRedos, SCENE_SECONDS, sceneVideoCost, scenePrompt, speaksOnScreen, withoutDialogue, type AdBrief, type AdPlan } from "@/lib/adplan";
import type { Analysis } from "@/lib/analyze";
import { faultText, type FaultCode } from "@/lib/promise";
import { post, waitFor, waitForResult } from "./storyRunner";
import { TALK_VIDEO_MODEL_ID } from "@/lib/talk";
import { isOwnVoice } from "@/lib/elevenlabs";
import { loadEleven, speakOwn, usableVoices } from "./elevenConnect";

export type AdClip = {
  url?: string;
  frame?: string;
  status: "waiting" | "working" | "done" | "failed";
  error?: string;
  frameChecked?: boolean; // the quality check looked at the first frame
  checked?: boolean; // the quality check looked at the finished scene
  /** Said on screen: the voice line (voice|words) the lips were matched to, and how long the scene lasts. */
  talkFor?: string;
  seconds?: number;
  /** Lip matching didn't work for this scene, so its line is read as a voiceover instead. */
  asVoiceover?: boolean;
};

/** The automatic quality check: it looks at every scene and remakes weak ones, up to a cap. */
export type AdCheck = {
  on: boolean;
  redosLeft: number;
  log: string[];
  /** Scenes that still had a clear fault when the remakes ran out: their credits come back under the promise. */
  faultsLeft?: { scene: number; fault: FaultCode; reason: string }[];
};

export type AdJob = {
  brief: AdBrief;
  plan: AdPlan;
  refs?: { url: string; kind: string; token: string }[];
  clips: AdClip[]; // one per scene
  voices: (string | undefined)[]; // one per scene, then the end card's
  voiceFor: string[]; // the line each voice clip was made from, so changed lines are re-read
  productUrl?: string; // our product picture (when the user gave no photo), reused in every scene
  productToken?: string;
  cardImage?: string;
  cardClip?: string;
  cardFor?: string; // headline|tagline the card was made with
  musicUrl?: string;
  musicFor?: string;
  joinedUrl?: string;
  step?: string;
  sceneModelId: string; // text-to-video
  animateModelId: string; // image-to-video, used with the product photo
  check?: AdCheck;
};

export const AD_T2V = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";
export const AD_I2V = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";

export function newAdJob(brief: AdBrief, plan: AdPlan, refs?: AdJob["refs"], check = true): AdJob {
  return {
    check: check ? { on: true, redosLeft: maxRedos(plan.scenes.length), log: [] } : undefined,
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

/** The product's look, made once and reused in every scene so it never changes design. */
async function productPicture(job: AdJob, aspectRatio: string): Promise<{ url: string; token: string }> {
  const res = await post("/api/generate", {
    modelId: "fal-ai/nano-banana",
    prompt: `Clean product photo of ${job.brief.product}. ${job.plan.look}. The whole product, centred, on a plain light background, soft studio light. No text, no logos, no people.`.slice(0, 1990),
    aspectRatio,
    enhance: false,
  });
  return waitForResult(res.modelId ?? "fal-ai/nano-banana", res);
}

/** A scene's first frame, showing the product from the user's photo or from our product picture. */
async function sceneFrame(job: AdJob, i: number, aspectRatio: string, fix = ""): Promise<string> {
  const res = await post("/api/generate", {
    modelId: "fal-ai/nano-banana/edit",
    prompt: `Opening frame of a video ad scene. The product must look exactly like the product in the reference picture. ${fix ? `Important: ${fix} ` : ""}${scenePrompt(job.plan, i)}`.slice(0, 1990),
    aspectRatio,
    enhance: false,
    purpose: "keyframe",
    refs: job.refs,
    productUrl: job.productUrl,
    productToken: job.productToken,
  });
  return waitFor(res.modelId ?? "fal-ai/nano-banana/edit", res);
}

async function sceneClip(job: AdJob, i: number, aspectRatio: string, frame?: string, fix = "", asVoiceover = false): Promise<string> {
  const modelId = frame ? job.animateModelId : job.sceneModelId;
  const res = await post("/api/generate", {
    modelId,
    prompt: `${fix ? `Important: ${fix} ` : ""}${scenePrompt(job.plan, i, asVoiceover)}`.slice(0, 1990),
    noText: !job.plan.allowText,
    aspectRatio,
    duration: SCENE_SECONDS,
    sound: false,
    enhance: true,
    sourceUrl: frame,
    purpose: frame ? "animate" : undefined,
  });
  return waitFor(modelId, res);
}

/** The voice key a talking scene was matched to: a new voice or new words mean new lips. */
const talkKey = (plan: AdPlan, i: number) => `${plan.voice}|${plan.scenes[i].voice}`;

/**
 * A scene said on screen: the opening picture speaks the recorded line, lips
 * matched to it. It lasts as long as the line.
 */
async function talkClip(job: AdJob, i: number, aspectRatio: string, frame: string, voiceUrl: string, fix = ""): Promise<{ url: string; seconds: number }> {
  const s = job.plan.scenes[i];
  const prompt = `${fix ? `Important: ${fix} ` : ""}The character says the line to camera with lively, natural expressions and small gestures, staying exactly as in the picture. ${withoutDialogue(s.visual)}. Camera: ${s.camera}. ${job.plan.allowText ? "" : "No speech bubbles, captions or text."}`;
  const res = await post("/api/tool", { tool: "talk-scene", imageUrl: frame, audioUrl: voiceUrl, text: s.voice, prompt: prompt.slice(0, 900), aspectRatio });
  if (res.status === "COMPLETED") return { url: res.url ?? "", seconds: lineSeconds(s.voice, job.brief.language) };
  const out = await waitForResult(res.modelId ?? TALK_VIDEO_MODEL_ID, res);
  return { url: out.url, seconds: out.seconds ?? lineSeconds(s.voice, job.brief.language) };
}

/** How long each scene lasts: filmed scenes are 5 seconds, scenes said on screen last as long as their line. */
export function sceneLengths(job: AdJob): number[] {
  return job.plan.scenes.map((_, i) => (job.clips[i]?.talkFor ? (job.clips[i].seconds ?? SCENE_SECONDS) : SCENE_SECONDS));
}

/**
 * Asks the checking AI to look at a frame or a scene. Returns null if the check
 * itself fails, because a failed check should never stop the ad.
 */
export async function checkPart(kind: "image" | "video", url: string, prompt: string, productUrl?: string, productNote?: string): Promise<Analysis | null> {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, url, prompt, productUrl, productNote, auto: true }),
    });
    let data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const started = Date.now();
    while (data.status !== "COMPLETED") {
      if (data.status === "FAILED" || Date.now() - started > 3 * 60 * 1000) return null;
      await new Promise((r) => setTimeout(r, 2500));
      const r = await fetch(`/api/analyze?kind=${kind}&requestId=${encodeURIComponent(data.requestId)}`);
      const next = await r.json().catch(() => ({}));
      data = { ...next, requestId: data.requestId };
    }
    return (data.analysis as Analysis) ?? null;
  } catch {
    return null;
  }
}

const fixText = (a: Analysis) => (a.fix || a.problems.join(" ")).slice(0, 400);
const firstProblem = (a: Analysis) => (a.problems[0] ?? "a problem").replace(/\.$/, "");

async function cardImage(job: AdJob, aspectRatio: string): Promise<string> {
  const withPicture = Boolean(job.refs?.length || job.productUrl);
  const modelId = withPicture ? "fal-ai/nano-banana/edit" : "fal-ai/nano-banana";
  const res = await post("/api/generate", {
    modelId,
    prompt: endCardPrompt(job.plan, withPicture, job.brief.brand),
    aspectRatio,
    enhance: false,
    refs: job.refs,
    productUrl: job.productUrl,
    productToken: job.productToken,
  });
  return waitFor(res.modelId ?? modelId, res);
}

/** Holds the end card on screen with a gentle, nearly still move. */
async function cardClip(job: AdJob): Promise<string> {
  return tool({ tool: "card", imageUrl: job.cardImage, seconds: endCardSeconds(job.plan.seconds) }, "fal-ai/ltxv-13b-098-distilled/image-to-video");
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
export async function buildAd(
  job: AdJob,
  aspectRatio: string,
  save: (j: AdJob, patch?: { stepStartedAt?: number; jobModelId?: string }) => void,
  opts: { live: boolean } = { live: true },
): Promise<{ url: string; hasAudio: boolean }> {
  const plan = job.plan;
  const n = plan.scenes.length;
  const step = (label: string, modelId: string) => {
    job.step = label;
    save(job, { stepStartedAt: Date.now(), jobModelId: modelId });
  };

  // Voiceover: one clip per line, so each lands on its own scene.
  const lines = voiceLines(plan);
  // The user's own ElevenLabs voice is recorded first, so a key or account problem
  // shows up before anything is paid for. Demo mode skips voiceovers, so it never uses their characters.
  const ownVoice = isOwnVoice(plan.voice);
  const conn = ownVoice && opts.live ? loadEleven() : null;
  if (ownVoice && opts.live && !usableVoices(conn).some((v) => `el:${v.id}` === plan.voice))
    throw new Error("This ad uses your ElevenLabs voice, but that voice isn't connected in this browser. Connect it in the Brand kit, or pick one of our voices in the plan.");
  async function recordVoices() {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      const key = `${plan.voice}|${lines[i]}`;
      if (job.voices[i] && job.voiceFor[i] === key) continue;
      if (ownVoice && !opts.live) continue;
      step(`Recording the voiceover (${i + 1} of ${lines.length})`, "fal-ai/elevenlabs/tts/turbo-v2.5");
      job.voices[i] =
        (ownVoice
          ? await speakOwn(conn!, plan.voice, lines[i], job.brief.language)
          : await tool({ tool: "voice", text: lines[i], voice: plan.voice }, "fal-ai/elevenlabs/tts/turbo-v2.5")) || undefined;
      job.voiceFor[i] = key;
      save(job);
    }
  }
  // Every line is recorded first (a few cents): a scene said on screen is made from its recording.
  await recordVoices();

  // Without the user's own photo, design the product once so every scene shows the same one.
  if (!job.refs?.length && !job.productUrl) {
    step("Designing your product", "fal-ai/nano-banana");
    const pic = await productPicture(job, aspectRatio);
    job.productUrl = pic.url;
    job.productToken = pic.token;
    save(job);
  }

  for (let i = 0; i < n; i++) {
    const clip = job.clips[i] ?? (job.clips[i] = { status: "waiting" });
    if (clip.url && (clip.checked || !job.check?.on)) continue;
    clip.status = "working";
    clip.error = undefined;
    try {
      const check = job.check?.on ? job.check : undefined;
      const productRef = job.refs?.find((r) => r.kind === "product")?.url ?? job.productUrl;
      if (!clip.frame) {
        step(`Scene ${i + 1} of ${n}: setting up the shot`, "fal-ai/nano-banana/edit");
        clip.frame = await sceneFrame(job, i, aspectRatio);
        save(job);
      }
      // A cheap look at the first frame before the expensive part: one new frame if it's clearly off.
      if (check && !clip.frameChecked) {
        step(`Scene ${i + 1} of ${n}: checking the shot`, "fal-ai/any-llm/vision");
        const a = await checkPart("image", clip.frame, scenePrompt(job.plan, i), productRef);
        if (a?.serious) {
          step(`Scene ${i + 1} of ${n}: fixing the shot`, "fal-ai/nano-banana/edit");
          clip.frame = await sceneFrame(job, i, aspectRatio, fixText(a));
          check.log.push(`Scene ${i + 1}: fixed the opening shot before filming (${firstProblem(a)}).`);
        }
        clip.frameChecked = true;
        save(job);
      }
      // Said on screen: made from the recorded line, so the lips match it. Without a recording (demo mode), or if
      // lip matching fails, the scene is filmed as usual and the line is read over it.
      const talks = speaksOnScreen(plan.scenes[i]) && !clip.asVoiceover && Boolean(job.voices[i]) && opts.live && !job.refs?.some((r) => r.kind === "person");
      if (!clip.url && talks) {
        step(`Scene ${i + 1} of ${n}: matching the lips to the voice`, TALK_VIDEO_MODEL_ID);
        try {
          const t = await talkClip(job, i, aspectRatio, clip.frame!, job.voices[i]!);
          clip.url = t.url;
          clip.seconds = t.seconds;
          clip.talkFor = talkKey(plan, i);
        } catch (e) {
          clip.asVoiceover = true;
          job.check?.log.push(`Scene ${i + 1}: the lips couldn't be matched to the voice (${(e as Error).message.replace(/\.$/, "")}), so the line is read as a voiceover.`);
        }
        save(job);
      }
      if (!clip.url) {
        step(`Scene ${i + 1} of ${n}`, job.animateModelId);
        clip.url = await sceneClip(job, i, aspectRatio, clip.frame, "", speaksOnScreen(plan.scenes[i]));
        save(job);
      }
      // Then the finished scene: remade once if it's clearly wrong, while the spending cap allows.
      if (check && !clip.checked) {
        step(`Scene ${i + 1} of ${n}: checking the scene`, "fal-ai/video-understanding");
        // The scene is checked against the product's description too, so a product that changes on the way through is caught.
        const productNote = `${job.brief.product}. ${job.plan.look}`;
        const a = await checkPart("video", clip.url, scenePrompt(job.plan, i), undefined, productNote);
        if (a?.serious && check.redosLeft > 0) {
          check.redosLeft--;
          clip.checked = true;
          save(job);
          if (clip.talkFor && job.voices[i]) {
            step(`Scene ${i + 1} of ${n}: remaking it`, TALK_VIDEO_MODEL_ID);
            const t = await talkClip(job, i, aspectRatio, clip.frame!, job.voices[i]!, fixText(a));
            clip.url = t.url;
            clip.seconds = t.seconds;
          } else {
            step(`Scene ${i + 1} of ${n}: remaking it`, job.animateModelId);
            clip.url = await sceneClip(job, i, aspectRatio, clip.frame, fixText(a), speaksOnScreen(plan.scenes[i]));
          }
          check.log.push(`Scene ${i + 1}: remade it (${firstProblem(a)}).`);
        } else if (a?.serious) {
          const fault = a.faults?.[0];
          if (fault) {
            (check.faultsLeft ??= []).push({ scene: i, fault, reason: faultText(fault) });
            check.log.push(`Scene ${i + 1}: ${firstProblem(a)}. Not remade, the automatic remakes were used up. It's a clear fault, so the credits for this scene come back. Ask in the chat to fix it.`);
          } else check.log.push(`Scene ${i + 1}: ${firstProblem(a)}. Not remade, the automatic remakes were used up. Ask in the chat to fix it.`);
        }
        clip.checked = true;
      }
      clip.status = "done";
    } catch (e) {
      clip.status = "failed";
      clip.error = (e as Error).message;
      save(job);
      throw e;
    }
    save(job);
  }

  // Scenes said on screen last as long as their line, so the ad's real length is added up from the scenes.
  const lengths = sceneLengths(job);
  const cardSecs = endCardSeconds(plan.seconds);
  const total = lengths.reduce((a, b) => a + b, 0) + cardSecs;
  const talking = job.clips.some((c) => c.talkFor);

  if (!job.musicUrl || job.musicFor !== plan.music) {
    step("Making the music", "cassetteai/music-generator");
    job.musicUrl = (await tool({ tool: "music", prompt: plan.music, seconds: Math.ceil(Math.max(total, plan.seconds)) }, "cassetteai/music-generator")) || undefined;
    job.musicFor = plan.music;
    save(job);
  }

  const cardKey = `${plan.endCard.headline}|${plan.endCard.tagline}`;
  if (!job.cardClip || job.cardFor !== cardKey) {
    if (!job.cardImage || job.cardFor !== cardKey) {
      step("Designing the end card", "fal-ai/nano-banana");
      job.cardImage = await cardImage(job, aspectRatio);
    }
    step("Finishing the end card", "fal-ai/ltxv-13b-098-distilled/image-to-video");
    job.cardClip = await cardClip(job);
    job.cardFor = cardKey;
    job.joinedUrl = undefined;
    save(job);
  }

  if (!job.joinedUrl) {
    step("Joining the scenes", "fal-ai/ffmpeg-api/merge-videos");
    const urls = [...job.clips.map((c) => c.url!), job.cardClip!];
    try {
      job.joinedUrl = await tool({ tool: "merge", urls }, "fal-ai/ffmpeg-api/merge-videos");
    } catch (e) {
      // Talking scenes carry their own sound and a different length; if the plain join can't take them, place them on a timeline.
      if (!talking) throw e;
      job.joinedUrl = await tool({ tool: "join", urls, durations: [...lengths, cardSecs], seconds: Math.ceil(total) }, "fal-ai/ffmpeg-api/compose");
    }
    save(job);
  }

  // Each line starts where its scene starts. A narrator line waits a breath; a line said on screen starts
  // exactly with the scene, because the lips were matched to it from the first frame.
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  const voices = lines
    .map((_, i) => {
      const said = i < n && Boolean(job.clips[i]?.talkFor);
      const start = i < n ? starts[i] : total - cardSecs;
      const len = i < n ? lengths[i] : cardSecs;
      return { url: job.voices[i], at: said ? start : start + 0.3, seconds: said ? len : len - 0.4 };
    })
    .filter((v) => v.url);
  const hasAudio = voices.length > 0 || Boolean(job.musicUrl);
  if (!hasAudio) return { url: job.joinedUrl!, hasAudio: false };
  step("Mixing voiceover and music", "fal-ai/ffmpeg-api/compose");
  const url = await tool({ tool: "mix", videoUrl: job.joinedUrl, voices, musicUrl: job.musicUrl, seconds: Math.round(total * 10) / 10 }, "fal-ai/ffmpeg-api/compose");
  job.step = undefined;
  return { url, hasAudio: true };
}

/**
 * A new version of an ad after the plan changed: scenes whose picture didn't
 * change are kept, so only the changed parts are made (and paid for) again.
 */
export function changedAdJob(old: AdJob, plan: AdPlan): { job: AdJob; scenes: number; sceneUsd: number; card: boolean; voiceChars: number; music: boolean } {
  const lookSame = old.plan.look === plan.look;
  let scenes = 0;
  let sceneUsd = 0;
  const clips: AdClip[] = plan.scenes.map((s, i) => {
    const before = old.plan.scenes[i];
    const prev = old.clips[i];
    // A scene said on screen was made from its line, so new words or a new voice mean new lips.
    const sameSpeech = prev?.talkFor ? prev.talkFor === `${plan.voice}|${s.voice}` && speaksOnScreen(s) : !speaksOnScreen(s) || Boolean(prev?.asVoiceover);
    const same = lookSame && before && before.visual === s.visual && before.camera === s.camera && prev?.url && sameSpeech;
    if (same) return { ...prev };
    scenes++;
    sceneUsd += sceneVideoCost(s, old.brief.language);
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
    productUrl: lookSame ? old.productUrl : undefined,
    productToken: lookSame ? old.productToken : undefined,
    cardImage: card ? undefined : old.cardImage,
    cardClip: card ? undefined : old.cardClip,
    cardFor: card ? undefined : old.cardFor,
    joinedUrl: scenes > 0 || card ? undefined : old.joinedUrl,
    step: undefined,
    check: old.check?.on ? { on: true, redosLeft: Math.min(maxRedos(plan.scenes.length), scenes), log: [] } : undefined,
  };
  return { job, scenes, sceneUsd, card, voiceChars, music };
}
