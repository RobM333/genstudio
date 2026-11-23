// "Auto" mode: picks the best model for a job, so users don't need to know
// which model is good at what. Simple keyword rules for now; easy to tune.

import { getModel, MODELS, type AspectRatio, type MediaKind, type ModelInfo } from "./models";

export type Quality = "draft" | "final";

export type Pick = { model: ModelInfo; reason: string };

const has = (prompt: string, words: string[]) => {
  const p = prompt.toLowerCase();
  return words.some((w) => new RegExp(`\\b${w}`).test(p));
};

const TEXT_WORDS = ["text", "headline", "caption", "title", "typography", "letter", "word", "sign", "says", "saying", "poster", "banner", "label", "slogan", "quote"];
const DESIGN_WORDS = ["logo", "icon", "vector", "illustration", "flat", "cartoon", "sticker", "pattern", "graphic", "infographic", "mascot"];
const SOUND_WORDS = ["sound", "audio", "music", "dialogue", "talking", "talks", "speaks", "speaking", "says", "saying", "voice", "singing", "narrat", "testimonial", "asmr"];

/** Returns the first model that supports the shape, starting from the preferred ids. */
function first(ids: string[], aspectRatio: AspectRatio, kind: MediaKind): ModelInfo {
  for (const id of ids) {
    const m = getModel(id);
    if (m && m.aspectRatios.includes(aspectRatio)) return m;
  }
  return MODELS.find((m) => m.kind === kind && m.aspectRatios.includes(aspectRatio)) ?? MODELS.find((m) => m.kind === kind)!;
}

export function pickModel(opts: { kind: MediaKind; prompt: string; quality: Quality; aspectRatio: AspectRatio }): Pick {
  const { kind, prompt, quality, aspectRatio } = opts;

  if (kind === "image") {
    const wantsText = has(prompt, TEXT_WORDS) || /["“].+["”]/.test(prompt);
    if (quality === "draft") {
      // FLUX Schnell misspells words, so drafts with words in them use a model that can spell.
      if (wantsText) {
        return { model: first(["fal-ai/nano-banana"], aspectRatio, kind), reason: "spells words in images correctly" };
      }
      return { model: first(["fal-ai/flux/schnell"], aspectRatio, kind), reason: "cheapest and fastest, good for trying ideas" };
    }
    if (wantsText) {
      return { model: first(["fal-ai/nano-banana"], aspectRatio, kind), reason: "best at readable text in images" };
    }
    if (has(prompt, DESIGN_WORDS)) {
      return { model: first(["fal-ai/recraft/v3/text-to-image"], aspectRatio, kind), reason: "best for logos, illustrations and brand graphics" };
    }
    return { model: first(["fal-ai/flux-pro/v1.1-ultra"], aspectRatio, kind), reason: "most detailed, photo-real results" };
  }

  // Video
  if (quality === "draft") {
    const m = first(["fal-ai/minimax/hailuo-02/standard/text-to-video", "fal-ai/kling-video/v2.5-turbo/pro/text-to-video"], aspectRatio, kind);
    return { model: m, reason: m.id.includes("hailuo") ? "lowest cost per second, good for checking the idea" : "cheapest model that supports this shape" };
  }
  if (has(prompt, SOUND_WORDS)) {
    return { model: first(["fal-ai/veo3/fast", "fal-ai/kling-video/v2.5-turbo/pro/text-to-video"], aspectRatio, kind), reason: "the only model that adds sound and speech" };
  }
  return { model: first(["fal-ai/kling-video/v2.5-turbo/pro/text-to-video"], aspectRatio, kind), reason: "cinematic motion at a fair price" };
}

/** Shapes available in Auto mode: any shape at least one model of this kind supports. */
export function autoAspectRatios(kind: MediaKind): AspectRatio[] {
  const all: AspectRatio[] = ["1:1", "16:9", "9:16"];
  return all.filter((ar) => MODELS.some((m) => m.kind === kind && m.aspectRatios.includes(ar)));
}
