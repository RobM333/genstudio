// The catalogue of AI models GenStudio can use.
// Each entry maps to a model hosted on fal.ai. Model ids and prices change
// often, so this is the one file to update when fal.ai adds or renames models.
// Prices are rough estimates for showing users; check fal.ai/pricing for real numbers.

export type MediaKind = "image" | "video";
export type AspectRatio = "1:1" | "16:9" | "9:16";

export type ModelInfo = {
  id: string; // fal.ai endpoint id
  name: string;
  kind: MediaKind;
  tagline: string;
  approxCost: string; // human readable, e.g. "~$0.003 / image"
  durations?: number[]; // seconds, video only
  audio?: boolean; // video models: true if the model makes its own sound
  silentApproxPrice?: number; // USD per second when its sound is switched off (if cheaper)
  aspectRatios: AspectRatio[];
  needsSource?: boolean; // works on an existing video (sourceUrl) instead of making a new one
  typicalSeconds?: number; // rough time a job takes once it starts, for the progress bar
  takesImage?: boolean; // animates a starting picture (sourceUrl) into a video
  buildInput: (opts: {
    prompt: string;
    aspectRatio: AspectRatio;
    duration?: number;
    sourceUrl?: string;
    sound?: boolean;
  }) => Record<string, unknown>;
};

const FLUX_SIZE: Record<AspectRatio, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
};

export const MODELS: ModelInfo[] = [
  // ---------- Images ----------
  {
    id: "fal-ai/flux/schnell",
    typicalSeconds: 4,
    name: "FLUX Schnell",
    kind: "image",
    tagline: "Fast and very cheap. Great for drafts.",
    approxCost: "~$0.003 / image",
    aspectRatios: ["1:1", "16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      image_size: FLUX_SIZE[aspectRatio],
      num_images: 1,
    }),
  },
  {
    id: "fal-ai/flux-pro/v1.1-ultra",
    typicalSeconds: 15,
    name: "FLUX 1.1 Pro Ultra",
    kind: "image",
    tagline: "High detail, photo-real results.",
    approxCost: "~$0.06 / image",
    aspectRatios: ["1:1", "16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
    }),
  },
  {
    id: "fal-ai/nano-banana",
    typicalSeconds: 12,
    name: "Nano Banana (Google)",
    kind: "image",
    tagline: "Spells words correctly, great for thumbnails, ads and posters.",
    approxCost: "~$0.04 / image",
    aspectRatios: ["1:1", "16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
    }),
  },
  {
    id: "fal-ai/recraft/v3/text-to-image",
    typicalSeconds: 15,
    name: "Recraft V3",
    kind: "image",
    tagline: "Design and brand style, logos, illustrations.",
    approxCost: "~$0.04 / image",
    aspectRatios: ["1:1", "16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      image_size: FLUX_SIZE[aspectRatio],
    }),
  },

  // ---------- Videos ----------
  {
    id: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    typicalSeconds: 180,
    name: "Hailuo 02",
    kind: "video",
    tagline: "Good quality for a low price.",
    approxCost: "~$0.045 / second",
    durations: [6, 10],
    aspectRatios: ["16:9"],
    buildInput: ({ prompt, duration }) => ({
      prompt,
      duration: String(duration ?? 6),
      prompt_optimizer: true,
    }),
  },
  {
    id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    typicalSeconds: 100,
    name: "Kling 2.5 Turbo Pro",
    kind: "video",
    tagline: "Cinematic motion, strong prompt following.",
    approxCost: "~$0.07 / second",
    durations: [5, 10],
    aspectRatios: ["16:9", "9:16", "1:1"],
    buildInput: ({ prompt, aspectRatio, duration }) => ({
      prompt,
      duration: String(duration ?? 5),
      aspect_ratio: aspectRatio,
    }),
  },
  {
    id: "fal-ai/veo3/fast",
    typicalSeconds: 75,
    audio: true,
    silentApproxPrice: 0.1,
    name: "Google Veo 3 Fast",
    kind: "video",
    tagline: "Top quality, with sound.",
    approxCost: "~$0.15 / second",
    durations: [8],
    aspectRatios: ["16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio, sound }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration: "8s",
      generate_audio: sound !== false,
    }),
  },
];

/**
 * Adds sound effects and ambience that match an existing silent video.
 * Not shown in the model picker; used by the "Add sound" button.
 */
export const ADD_SOUND_MODEL: ModelInfo = {
  id: "fal-ai/mmaudio-v2",
    typicalSeconds: 25,
  name: "MMAudio (add sound)",
  kind: "video",
  tagline: "Adds matching sound effects and ambience to a silent video.",
  approxCost: "~$0.001 / second",
  audio: true,
  needsSource: true,
  aspectRatios: ["16:9", "9:16", "1:1"],
  buildInput: ({ prompt, duration, sourceUrl }) => ({
    video_url: sourceUrl,
    prompt,
    duration: Math.min(Math.max(duration ?? 8, 1), 30),
  }),
};

/**
 * Fixes part of an existing image from a plain instruction ("make the text say
 * I TRIED IT"), keeping the rest. Not shown in the picker; used by "Fix this".
 */
export const EDIT_IMAGE_MODEL: ModelInfo = {
  id: "fal-ai/flux-pro/kontext",
    typicalSeconds: 12,
  name: "FLUX Kontext (fix)",
  kind: "image",
  tagline: "Changes part of an image and keeps the rest.",
  approxCost: "~$0.04 / image",
  needsSource: true,
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: ({ prompt, aspectRatio, sourceUrl }) => ({
    prompt,
    image_url: sourceUrl,
    aspect_ratio: aspectRatio,
    output_format: "png",
  }),
};

/**
 * "Animate a picture" versions of the video models. Used by the picture-first
 * flow: the user approves a still first, then it is brought to life, so the
 * layout (who stands where, which way they face) is already right.
 */
export const ANIMATE_MODELS: ModelInfo[] = [
  {
    id: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    typicalSeconds: 180,
    name: "Hailuo 02 (animate)",
    kind: "video",
    tagline: "Animates your picture for a low price.",
    approxCost: "~$0.045 / second",
    durations: [6, 10],
    aspectRatios: ["16:9", "9:16", "1:1"],
    takesImage: true,
    buildInput: ({ prompt, duration, sourceUrl }) => ({
      prompt,
      image_url: sourceUrl,
      duration: String(duration ?? 6),
      prompt_optimizer: true,
    }),
  },
  {
    id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    typicalSeconds: 100,
    name: "Kling 2.5 Turbo Pro (animate)",
    kind: "video",
    tagline: "Cinematic motion from your picture.",
    approxCost: "~$0.07 / second",
    durations: [5, 10],
    aspectRatios: ["16:9", "9:16", "1:1"],
    takesImage: true,
    buildInput: ({ prompt, duration, sourceUrl }) => ({
      prompt,
      image_url: sourceUrl,
      duration: String(duration ?? 5),
    }),
  },
  {
    id: "fal-ai/veo3/fast/image-to-video",
    typicalSeconds: 75,
    audio: true,
    silentApproxPrice: 0.1,
    name: "Google Veo 3 Fast (animate)",
    kind: "video",
    tagline: "Top quality from your picture, with sound.",
    approxCost: "~$0.15 / second",
    durations: [8],
    aspectRatios: ["16:9", "9:16"],
    takesImage: true,
    buildInput: ({ prompt, aspectRatio, sound, sourceUrl }) => ({
      prompt,
      image_url: sourceUrl,
      aspect_ratio: aspectRatio,
      duration: "8s",
      generate_audio: sound !== false,
    }),
  },
];

/** The "animate a picture" model that matches a text-to-video model. */
export function animateModelFor(videoModelId: string): ModelInfo {
  const key = videoModelId.includes("veo3") ? "veo3" : videoModelId.includes("kling") ? "kling" : "hailuo";
  return ANIMATE_MODELS.find((m) => m.id.includes(key))!;
}

/** Makes the starting picture for picture-first videos: follows layout and directions closely. */
export const KEYFRAME_MODEL_ID = "fal-ai/nano-banana";

const HIDDEN = [ADD_SOUND_MODEL, EDIT_IMAGE_MODEL, ...ANIMATE_MODELS];

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id) ?? HIDDEN.find((m) => m.id === id);
}

/** Only accept result images and videos that fal.ai itself hosts, so the key can't be used on random URLs. */
export function isFalMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "fal.media" || u.hostname.endsWith(".fal.media") ||
        (u.hostname === "storage.googleapis.com" && u.pathname.startsWith("/falserverless/")))
    );
  } catch {
    return false;
  }
}

/** Pulls the first image or video URL out of a fal.ai result, whatever its shape. */
export function extractMediaUrl(data: unknown): string | undefined {
  const d = data as Record<string, any> | null;
  if (!d) return undefined;
  return d.images?.[0]?.url ?? d.image?.url ?? d.video?.url ?? d.videos?.[0]?.url;
}

/** Rough USD per image, or per second for video, read from approxCost. */
export function unitPrice(model: ModelInfo): number {
  return parseFloat(model.approxCost.match(/[\d.]+/)?.[0] ?? "0");
}

/**
 * Rough cost of one job in USD. For videos, `sound` true includes either the
 * model's own sound or the add-sound step for silent models.
 */
export function estimateCost(model: ModelInfo, duration?: number, sound = false): number {
  const unit = unitPrice(model);
  if (model.kind !== "video") return unit;
  const secs = duration ?? model.durations?.[0] ?? 5;
  if (model.needsSource) return unit * secs;
  if (model.audio) return (sound ? unit : (model.silentApproxPrice ?? unit)) * secs;
  return unit * secs + (sound ? unitPrice(ADD_SOUND_MODEL) * secs : 0);
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? "under 1 cent" : "~$" + usd.toFixed(2);
}
