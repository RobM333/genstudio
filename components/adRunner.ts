// Builds a full ad in the browser, one short fal job at a time, so nothing hits
// the hosting time limit: each scene (from the user's product photo when given),
// the end card, the voiceover lines and the music, then one join and one mix.
// A scene whose line is said on screen is made in one step by Kling 3: the line is
// in the prompt and the model makes the voice and the moving mouth together. With
// the user's own ElevenLabs voice, or a language other than English, the voice is
// recorded first and the lips are matched to that recording instead. Narrator
// scenes are filmed with nobody talking and the voice laid over them.
// Progress is saved on the item, so a closed page carries on where it stopped.

import { cardLines, inkFor } from "@/lib/endcard";
import { finishReference } from "@/components/ReferencesBox";
import { endCardPrompt, endCardSeconds, frameLead, lineSeconds, maxRedos, nativeTalk, SCENE_SECONDS, sceneVideoCost, scenePrompt, speaksOnScreen, talkScenePrompt, withoutDialogue, type AdBrief, type AdPlan } from "@/lib/adplan";
import type { Analysis } from "@/lib/analyze";
import { faultText, type FaultCode } from "@/lib/promise";
import { post, waitFor, waitForResult } from "./storyRunner";
import { TALK_VIDEO_MODEL_ID } from "@/lib/talk";
import { NATIVE_TALK_MODELS, REFERENCE_IMAGE_PRO_MODEL } from "@/lib/models";
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
  /** Made in one step by Kling 3: the scene carries its own voice, so no recording is laid over it. */
  ownSound?: boolean;
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
/**
 * True when a picture has black bars along the top and bottom (or the sides):
 * the picture model sometimes letterboxes a frame, and the checking AI can miss it.
 * Looks at the pixels in the browser, so it costs nothing. Unknown means no.
 */
export async function hasBlackBars(url: string): Promise<boolean> {
  try {
    if (typeof document === "undefined") return false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error("load"));
      img.src = url;
    });
    const w = 64;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    return barsIn(px, w, h);
  } catch {
    return false;
  }
}

/** Pixels (RGBA) of a small copy of the picture: are the outer bands, top and bottom or left and right, almost black? */
export function barsIn(px: Uint8ClampedArray | number[], w: number, h: number): boolean {
  const dark = (x0: number, y0: number, x1: number, y1: number) => {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const k = (y * w + x) * 4;
        sum += Math.max(px[k], px[k + 1], px[k + 2]);
        n++;
      }
    return n > 0 && sum / n < 14;
  };
  const band = (n: number) => Math.max(1, Math.round(n * 0.08));
  const bh = band(h);
  const bw = band(w);
  return (dark(0, 0, w, bh) && dark(0, h - bh, w, h)) || (dark(0, 0, bw, h) && dark(w - bw, 0, w, h));
}

const NO_BARS = "Fill the whole frame edge to edge: no black bars, borders or letterboxing at the top, bottom or sides.";

/** The scene's opening picture; made once more if it came out with black bars. */
async function sceneFrame(job: AdJob, i: number, aspectRatio: string, fix = ""): Promise<string> {
  const url = await sceneFrameOnce(job, i, aspectRatio, fix);
  if (!(await hasBlackBars(url))) return url;
  // The usual picture model tends to letterbox again, so the remake uses the stronger one, which keeps the shape.
  job.check?.log.push(`Scene ${i + 1}: the opening picture had black bars, so it was made again.`);
  return sceneFrameOnce(job, i, aspectRatio, `${NO_BARS} ${fix}`.trim(), REFERENCE_IMAGE_PRO_MODEL.id);
}

async function sceneFrameOnce(job: AdJob, i: number, aspectRatio: string, fix = "", modelId = "fal-ai/nano-banana/edit"): Promise<string> {
  const res = await post("/api/generate", {
    modelId,
    prompt: `${frameLead((job.refs ?? []).map((r) => r.kind))} ${fix ? `Important: ${fix} ` : ""}${scenePrompt(job.plan, i)}`.slice(0, 1990),
    aspectRatio,
    enhance: false,
    purpose: "keyframe",
    refs: job.refs,
    productUrl: job.productUrl,
    productToken: job.productToken,
  });
  return waitFor(res.modelId ?? modelId, res);
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

const NATIVE_TALK_ID = NATIVE_TALK_MODELS.kling3.id;

/** A scene said on screen in one step: Kling 3 speaks the line from the prompt, voice and mouth together. 5 seconds. */
async function nativeTalkClip(job: AdJob, i: number, aspectRatio: string, frame: string, fix = ""): Promise<string> {
  const res = await post("/api/tool", { tool: "talk-native", model: "kling3", imageUrl: frame, prompt: talkScenePrompt(job.plan, i, fix), aspectRatio });
  if (res.status === "COMPLETED") return res.url ?? "";
  return waitFor(res.modelId ?? NATIVE_TALK_ID, res);
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
    prompt: endCardPrompt(job.plan, withPicture, job.brief.brand, (job.refs ?? []).map((r) => r.kind)),
    aspectRatio,
    enhance: false,
    refs: job.refs,
    productUrl: job.productUrl,
    productToken: job.productToken,
  });
  return waitFor(res.modelId ?? modelId, res);
}

/**
 * Types the end card's words onto the picture in the browser (picture models
 * misspell words), then uploads it through the usual picture safety check.
 */
export async function withCardText(url: string, words: { headline: string; tagline?: string; website?: string }, colors: string[] = []): Promise<string> {
  if (typeof document === "undefined") return url;
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((ok, bad) => {
    img.onload = () => ok();
    img.onerror = () => bad(new Error("We couldn't load the end card picture. Please try again."));
    img.src = url;
  });
  try {
    await document.fonts?.load('800 40px "Inter Tight"');
  } catch {
    // the fallback sans-serif font is used
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const font = (size: number, weight: number) => `${weight} ${size}px "Inter Tight", ui-sans-serif, system-ui, sans-serif`;
  const measure = (t: string, size: number, weight: number) => {
    ctx.font = font(size, weight);
    return ctx.measureText(t).width;
  };
  const lines = cardLines(w, h, words, measure);
  const last = lines[lines.length - 1];
  // A soft dark fade behind the words keeps them readable on any background.
  const fade = ctx.createLinearGradient(0, 0, 0, Math.min(h, (last?.y ?? 0) + h * 0.12));
  fade.addColorStop(0, "rgba(0,0,0,0.55)");
  fade.addColorStop(0.75, "rgba(0,0,0,0.35)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, Math.min(h, (last?.y ?? 0) + h * 0.12));
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const accent = colors.find((x) => /^#?[0-9a-f]{6}$/i.test(x)) ?? "#f5a623";
  for (const l of lines) {
    ctx.font = font(l.size, l.weight);
    if (l.pill) {
      const tw = ctx.measureText(l.text).width;
      const padX = l.size * 0.7;
      const ph = l.size * 1.7;
      const x = w / 2 - tw / 2 - padX;
      const top = l.y - l.size * 1.2;
      ctx.shadowColor = "transparent";
      ctx.fillStyle = accent.startsWith("#") ? accent : `#${accent}`;
      ctx.beginPath();
      ctx.roundRect(x, top, tw + padX * 2, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = inkFor(accent);
      ctx.fillText(l.text, w / 2, l.y);
      continue;
    }
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = l.size * 0.25;
    ctx.shadowOffsetY = l.size * 0.05;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(l.text, w / 2, l.y);
  }
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.92));
  if (!blob) throw new Error("We couldn't finish the end card. Please try again.");
  const form = new FormData();
  form.append("file", blob, "end-card.jpg");
  form.append("kind", "style");
  form.append("consent", "yes");
  const res = await fetch("/api/reference", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "We couldn't finish the end card. Please try again.");
  return (await finishReference(data, "style")).url;
}

/** Holds the end card on screen with a gentle, nearly still move. */
async function cardClip(job: AdJob, seconds: number): Promise<string> {
  return tool({ tool: "card", imageUrl: job.cardImage, seconds }, "fal-ai/ltxv-13b-098-distilled/image-to-video");
}

/**
 * The end card's length. Scenes said on screen are shorter than 5 seconds, so the
 * card holds up to 2 seconds longer to keep the ad near the length asked for.
 */
export function cardLength(plan: AdPlan, lengths: number[]): number {
  const base = endCardSeconds(plan.seconds);
  const gap = plan.seconds - lengths.reduce((a, b) => a + b, 0);
  return Math.round(Math.min(base + 2, Math.max(base, gap)) * 10) / 10;
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
  // Scenes Kling 3 says on screen make their own voice, so their lines aren't recorded (unless the scene falls back to a voiceover).
  const oneStep = nativeTalk(plan.voice, job.brief.language) && opts.live && !job.refs?.some((r) => r.kind === "person");
  const selfSpoken = (i: number) => i < n && oneStep && speaksOnScreen(plan.scenes[i]) && !job.clips[i]?.asVoiceover;
  async function recordVoices() {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i] || selfSpoken(i)) continue;
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
  // Lines are recorded first (a few cents): a lip-matched scene is made from its recording.
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
      if (!clip.url && selfSpoken(i)) {
        step(`Scene ${i + 1} of ${n}: filming the character saying the line`, NATIVE_TALK_ID);
        try {
          clip.url = await nativeTalkClip(job, i, aspectRatio, clip.frame!);
          clip.seconds = SCENE_SECONDS;
          clip.talkFor = talkKey(plan, i);
          clip.ownSound = true;
        } catch (e) {
          clip.asVoiceover = true;
          job.check?.log.push(`Scene ${i + 1}: the character couldn't be made to say the line (${(e as Error).message.replace(/\.$/, "")}), so the line is read as a voiceover.`);
          await recordVoices();
        }
        save(job);
      }
      const talks = !oneStep && speaksOnScreen(plan.scenes[i]) && !clip.asVoiceover && Boolean(job.voices[i]) && opts.live && !job.refs?.some((r) => r.kind === "person");
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
          if (clip.ownSound) {
            step(`Scene ${i + 1} of ${n}: remaking it`, NATIVE_TALK_ID);
            clip.url = await nativeTalkClip(job, i, aspectRatio, clip.frame!, fixText(a));
          } else if (clip.talkFor && job.voices[i]) {
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
  const cardSecs = cardLength(plan, lengths);
  const total = lengths.reduce((a, b) => a + b, 0) + cardSecs;
  const talking = job.clips.some((c) => c.talkFor);

  const musicKey = `${plan.music}|${Math.ceil(total)}`;
  const musicOk = job.musicFor === musicKey || (job.musicFor === plan.music && Math.ceil(total) === plan.seconds);
  if (!job.musicUrl || !musicOk) {
    step("Making the music", "cassetteai/music-generator");
    job.musicUrl = (await tool({ tool: "music", prompt: plan.music, seconds: Math.ceil(total) }, "cassetteai/music-generator")) || undefined;
    // The mix runs as long as the music, so music made for a longer ad would freeze the end card.
    job.musicFor = musicKey;
    save(job);
  }

  const cardKey = `text2|${plan.endCard.headline}|${plan.endCard.tagline}|${job.brief.brand?.website ?? ""}${cardSecs !== endCardSeconds(plan.seconds) ? `|${cardSecs}` : ""}`;
  if (!job.cardClip || job.cardFor !== cardKey) {
    if (!job.cardImage || job.cardFor !== cardKey) {
      step("Designing the end card", "fal-ai/nano-banana");
      const picture = await cardImage(job, aspectRatio);
      step("Writing the end card words", "fal-ai/nano-banana");
      job.cardImage = await withCardText(picture, { ...plan.endCard, website: job.brief.brand?.website }, job.brief.brand?.colors);
    }
    step("Finishing the end card", "fal-ai/ltxv-13b-098-distilled/image-to-video");
    job.cardClip = await cardClip(job, cardSecs);
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
      // A Kling 3 scene's own sound goes on the voice track, so its voice is kept even if the mix leaves out the video's sound.
      if (said && job.clips[i]?.ownSound) return { url: job.clips[i].url, at: start, seconds: len };
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
    const sameSpeech = prev?.talkFor ? prev.talkFor === `${plan.voice}|${s.voice}` && speaksOnScreen(s) && Boolean(prev.ownSound) === nativeTalk(plan.voice, old.brief.language) : !speaksOnScreen(s) || Boolean(prev?.asVoiceover);
    const same = lookSame && before && before.visual === s.visual && before.camera === s.camera && prev?.url && sameSpeech;
    if (same) return { ...prev };
    scenes++;
    sceneUsd += sceneVideoCost(s, old.brief.language, plan.voice);
    return { status: "waiting" };
  });
  const card = old.plan.endCard.headline !== plan.endCard.headline || old.plan.endCard.tagline !== plan.endCard.tagline || !lookSame;
  const lines = voiceLines(plan);
  const voiceChars = lines.reduce((n, l, i) => n + (old.voiceFor[i] === `${plan.voice}|${l}` ? 0 : l.length), 0);
  const music = old.musicFor !== plan.music && !old.musicFor?.startsWith(`${plan.music}|`);
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
