// The catalogue of AI models ToastyFly can use.
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
  hd?: boolean; // already comes out sharp (1080p video, or a large picture), so "Sharpen to HD" isn't offered
  buildInput: (opts: {
    prompt: string;
    aspectRatio: AspectRatio;
    duration?: number;
    sourceUrl?: string;
    sound?: boolean;
    refUrls?: string[]; // the user's own reference pictures (product, logo, person)
    scale?: number; // how much bigger "Sharpen to HD" makes it
    avoid?: string; // things that must not appear (sent as a negative prompt where the model supports it)
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
    hd: true,
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
    hd: true,
    name: "Kling 2.5 Turbo Pro",
    kind: "video",
    tagline: "Cinematic motion, strong prompt following.",
    approxCost: "~$0.07 / second",
    durations: [5, 10],
    aspectRatios: ["16:9", "9:16", "1:1"],
    buildInput: ({ prompt, aspectRatio, duration, avoid }) => ({
      prompt,
      duration: String(duration ?? 5),
      aspect_ratio: aspectRatio,
      ...(avoid ? { negative_prompt: avoid } : {}),
    }),
  },
  {
    // Checked on fal.ai 2026-11-24: $0.157/s at 720p, $0.235/s at 1080p, 3 to 30 seconds.
    // It makes no sound of its own, so sound is added afterwards like the other silent models.
    id: "kling/v4/text-to-video",
    typicalSeconds: 200,
    hd: true,
    name: "Kling 4 (premium)",
    kind: "video",
    tagline: "Our sharpest, most lifelike video, in full HD.",
    approxCost: "~$0.235 / second",
    durations: [5, 10, 15],
    aspectRatios: ["16:9", "9:16", "1:1"],
    buildInput: ({ prompt, aspectRatio, duration }) => ({
      prompt,
      duration: duration ?? 5,
      resolution: "1080p",
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
    hd: true,
    name: "Kling 2.5 Turbo Pro (animate)",
    kind: "video",
    tagline: "Cinematic motion from your picture.",
    approxCost: "~$0.07 / second",
    durations: [5, 10],
    aspectRatios: ["16:9", "9:16", "1:1"],
    takesImage: true,
    buildInput: ({ prompt, duration, sourceUrl, avoid }) => ({
      prompt,
      image_url: sourceUrl,
      duration: String(duration ?? 5),
      ...(avoid ? { negative_prompt: avoid } : {}),
    }),
  },
  {
    id: "kling/v4/image-to-video",
    typicalSeconds: 200,
    hd: true,
    name: "Kling 4 (animate)",
    kind: "video",
    tagline: "Our sharpest video, from your picture.",
    approxCost: "~$0.235 / second",
    durations: [5, 10, 15],
    aspectRatios: ["16:9", "9:16", "1:1"],
    takesImage: true,
    buildInput: ({ prompt, duration, sourceUrl }) => ({
      prompt,
      start_image_url: sourceUrl,
      duration: duration ?? 5,
      resolution: "1080p",
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
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    takesImage: true,
    buildInput: ({ prompt, aspectRatio, duration, sound, sourceUrl }) => ({
      prompt,
      image_url: sourceUrl,
      aspect_ratio: aspectRatio,
      duration: `${duration ?? 8}s`,
      generate_audio: sound !== false,
    }),
  },
];

/** The "animate a picture" model that matches a text-to-video model. */
export function animateModelFor(videoModelId: string): ModelInfo {
  const key = videoModelId.includes("veo3")
    ? "veo3"
    : videoModelId.includes("kling/v4")
      ? "kling/v4"
      : videoModelId.includes("kling")
        ? "kling-video"
        : "hailuo";
  return ANIMATE_MODELS.find((m) => m.id.includes(key))!;
}

/** Makes the starting picture for picture-first videos: follows layout and directions closely. */
export const KEYFRAME_MODEL_ID = "fal-ai/nano-banana";

/**
 * Makes a new picture that uses the user's own reference pictures: their real
 * product, logo or a person who agreed to it. Used automatically when references
 * are attached; the first frame of a video can use it too, and then gets animated.
 */
export const REFERENCE_IMAGE_MODEL: ModelInfo = {
  id: "fal-ai/nano-banana/edit",
  typicalSeconds: 15,
  name: "Nano Banana (with your references)",
  kind: "image",
  tagline: "Puts your real product, logo or person into the picture.",
  approxCost: "~$0.04 / image",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: ({ prompt, aspectRatio, refUrls }) => ({
    prompt,
    image_urls: refUrls ?? [],
    aspect_ratio: aspectRatio,
    num_images: 1,
  }),
};

/**
 * The stronger reference picture model, used only when the usual one letterboxes
 * an ad's opening picture (black bars): it keeps to the shape asked for.
 */
export const REFERENCE_IMAGE_PRO_MODEL: ModelInfo = {
  id: "fal-ai/nano-banana-pro/edit",
  typicalSeconds: 30,
  name: "Nano Banana Pro (with your references)",
  kind: "image",
  tagline: "Puts your real product, logo or character into the picture, in the exact shape asked for.",
  approxCost: "~$0.15 / image",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: ({ prompt, aspectRatio, refUrls }) => ({
    prompt,
    image_urls: refUrls ?? [],
    aspect_ratio: aspectRatio,
    resolution: "1K",
    num_images: 1,
  }),
};

/** Storyboard helpers on fal (used through /api/tool, not the picker). */
export const LAST_FRAME_MODEL: ModelInfo = {
  id: "fal-ai/ffmpeg-api/extract-frame",
  typicalSeconds: 8,
  name: "Last frame",
  kind: "image",
  tagline: "Takes the last frame of a video so the next shot can continue from it.",
  approxCost: "~$0.001",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: ({ sourceUrl }) => ({ video_url: sourceUrl, frame_type: "last" }),
};
export const MERGE_VIDEOS_MODEL: ModelInfo = {
  id: "fal-ai/ffmpeg-api/merge-videos",
  typicalSeconds: 20,
  name: "Join shots",
  kind: "video",
  tagline: "Joins the shots of a storyboard into one video.",
  approxCost: "~$0.001",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};

/** Full ad helpers (used through /api/tool). Prices checked on fal.ai 2026-11-23. */
export const VOICE_MODEL: ModelInfo = {
  id: "fal-ai/elevenlabs/tts/turbo-v2.5",
  typicalSeconds: 8,
  name: "Voiceover",
  kind: "video",
  tagline: "Reads the voiceover in a natural voice.",
  approxCost: "~$0.05 / 1000 characters",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};
export const MUSIC_MODEL: ModelInfo = {
  id: "cassetteai/music-generator",
  typicalSeconds: 20,
  name: "Music",
  kind: "video",
  tagline: "Makes an instrumental music bed.",
  approxCost: "~$0.02 / minute",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};
export const COMPOSE_MODEL: ModelInfo = {
  id: "fal-ai/ffmpeg-api/compose",
  typicalSeconds: 25,
  name: "Mix",
  kind: "video",
  tagline: "Mixes the video, voiceover and music into one file.",
  approxCost: "~$0.0002 / second",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};

/** Script to Video helpers (used through /api/tool). Prices checked on fal.ai 2026-11-28. */
export const MERGE_AUDIO_MODEL: ModelInfo = {
  id: "fal-ai/ffmpeg-api/merge-audios",
  typicalSeconds: 15,
  name: "Join voice",
  kind: "video",
  tagline: "Joins the voiceover lines into one track.",
  approxCost: "~$0.001",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};
export const TRANSCRIBE_MODEL: ModelInfo = {
  id: "fal-ai/whisper",
  typicalSeconds: 30,
  name: "Line up your recording",
  kind: "video",
  tagline: "Hears your own recording so each shot starts with its line.",
  approxCost: "~$0.02 / minute",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};
export const CAPTIONS_MODEL: ModelInfo = {
  id: "fal-ai/workflow-utilities/auto-subtitle",
  typicalSeconds: 60,
  name: "Captions",
  kind: "video",
  tagline: "Adds captions to the finished video.",
  approxCost: "~$0.03 / minute",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};

/** Brings the ad's end card to life with a gentle, nearly still move ($0.02 per second). */
export const CARD_MOTION_MODEL: ModelInfo = {
  id: "fal-ai/ltxv-13b-098-distilled/image-to-video",
  typicalSeconds: 40,
  name: "End card",
  kind: "video",
  tagline: "Holds the end card on screen with a gentle move.",
  approxCost: "~$0.02 / second",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};

/**
 * "Sharpen to HD": makes a finished picture or video bigger and crisper at the end.
 * Checked on fal.ai 2026-11-24. Pictures: SeedVR at $0.001 per megapixel (a few
 * tenths of a cent). Videos: Topaz at $0.02 per second up to 1080p.
 */
export const HD_IMAGE_MODEL: ModelInfo = {
  id: "fal-ai/seedvr/upscale/image",
  typicalSeconds: 15,
  name: "Sharpen to HD",
  kind: "image",
  tagline: "Makes the picture twice as big and crisper.",
  approxCost: "~$0.01 / image",
  needsSource: true,
  hd: true,
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: ({ sourceUrl }) => ({
    image_url: sourceUrl,
    upscale_mode: "factor",
    upscale_factor: 2,
    output_format: "png",
  }),
};
export const HD_VIDEO_MODEL: ModelInfo = {
  id: "fal-ai/topaz/upscale/video",
  typicalSeconds: 90,
  name: "Sharpen to HD",
  kind: "video",
  tagline: "Makes the video full HD (1080p) and crisper.",
  approxCost: "~$0.02 / second",
  needsSource: true,
  hd: true,
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: ({ sourceUrl, scale }) => ({
    video_url: sourceUrl,
    model: "Proteus",
    // Kept at or under 1080p, which is the cheaper price band.
    upscale_factor: Math.min(Math.max(scale ?? 1.5, 1), 1.5),
    // Browsers can't all play the default H.265, so ask for H.264.
    H264_output: true,
  }),
};

/** How much "Sharpen to HD" enlarges a video from this model to reach about 1080p (0 = already HD). */
export function hdScaleFor(modelId: string): number {
  const m = getModel(modelId);
  if (!m || m.hd) return 0;
  if (modelId.includes("hailuo") || modelId.includes("minimax")) return 1.4; // 768p to about 1075p
  return 1.5; // 720p to 1080p
}

/** Talking videos in your own voice (used through /api/talk). Prices checked on fal.ai 2026-11-24. */
export const TALK_SPEECH_MODEL: ModelInfo = {
  id: "fal-ai/minimax/speech-02-hd",
  typicalSeconds: 10,
  name: "Your voice",
  kind: "video",
  tagline: "Reads the words in the user's own copied voice.",
  approxCost: "~$0.10 / 1000 characters",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};
export const TALK_VIDEO_MODEL: ModelInfo = {
  id: "fal-ai/kling-video/ai-avatar/v2/pro",
  typicalSeconds: 240,
  name: "Talking video",
  kind: "video",
  tagline: "Makes the photo talk, with the lips matched to the voice.",
  approxCost: "~$0.115 / second",
  aspectRatios: ["1:1", "16:9", "9:16"],
  buildInput: () => ({}),
};

/**
 * One-step talking scenes: the model makes the voice and the moving mouth together from a quoted line in the
 * prompt, instead of voice first and lip matching after. Checked on fal 2026-11-25. Full ad uses Kling 3 for
 * scenes said on screen (Rob picked it after a side-by-side test); Seedance stays for tests only.
 */
export const NATIVE_TALK_MODELS: Record<"kling3" | "seedance", ModelInfo> = {
  kling3: {
    id: "fal-ai/kling-video/v3/pro/image-to-video",
    typicalSeconds: 180,
    name: "Kling 3 talking scene",
    kind: "video",
    audio: true,
    tagline: "Voice and mouth made together.",
    approxCost: "~$0.168 / second",
    aspectRatios: ["1:1", "16:9", "9:16"],
    buildInput: ({ prompt, duration, sourceUrl, avoid }) => ({
      prompt,
      start_image_url: sourceUrl,
      duration: String(duration ?? 5),
      generate_audio: true,
      ...(avoid ? { negative_prompt: avoid } : {}),
    }),
  },
  seedance: {
    // 480p: $0.2205/s. 720p would be $0.473/s.
    id: "bytedance/seedance-2.5/image-to-video",
    typicalSeconds: 180,
    name: "Seedance 2.5 talking scene",
    kind: "video",
    audio: true,
    tagline: "Voice and mouth made together.",
    approxCost: "~$0.2205 / second",
    aspectRatios: ["1:1", "16:9", "9:16"],
    buildInput: ({ prompt, duration, sourceUrl }) => ({
      prompt,
      image_url: sourceUrl,
      duration: String(duration ?? 5),
      resolution: "480p",
      generate_audio: true,
    }),
  },
};

/**
 * Models used only as backups (lib/backups.ts), never picked by people directly.
 * Veo 3.1 Fast: checked on fal.ai 2026-11-28, same input and price as Veo 3 Fast
 * ($0.15/s with sound, $0.10/s without), which fal now lists as deprecated.
 */
export const BACKUP_ONLY_MODELS: ModelInfo[] = [
  {
    id: "fal-ai/veo3.1/fast",
    typicalSeconds: 75,
    audio: true,
    silentApproxPrice: 0.1,
    name: "Google Veo 3.1 Fast",
    kind: "video",
    tagline: "Top quality, with sound.",
    approxCost: "~$0.15 / second",
    durations: [8],
    aspectRatios: ["16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio, sound, avoid }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration: "8s",
      generate_audio: sound !== false,
      ...(avoid ? { negative_prompt: avoid } : {}),
    }),
  },
];

const HIDDEN = [...Object.values(NATIVE_TALK_MODELS), HD_IMAGE_MODEL, HD_VIDEO_MODEL, ADD_SOUND_MODEL, EDIT_IMAGE_MODEL, REFERENCE_IMAGE_MODEL, REFERENCE_IMAGE_PRO_MODEL, LAST_FRAME_MODEL, MERGE_VIDEOS_MODEL, VOICE_MODEL, MUSIC_MODEL, COMPOSE_MODEL, CARD_MOTION_MODEL, MERGE_AUDIO_MODEL, TRANSCRIBE_MODEL, CAPTIONS_MODEL, TALK_SPEECH_MODEL, TALK_VIDEO_MODEL, ...ANIMATE_MODELS, ...BACKUP_ONLY_MODELS];

/** Every model id in the catalogue, shown or not. */
export function allModelIds(): string[] {
  return [...MODELS, ...HIDDEN].map((m) => m.id);
}

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id) ?? HIDDEN.find((m) => m.id === id);
}

/** Only accept result images and videos that fal.ai itself hosts, so the key can't be used on random URLs. */
/** Free stock video files (Pexels and Pixabay) that Script to Video may place in a video. */
export function isStockVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "videos.pexels.com" || u.hostname === "cdn.pixabay.com") && /\.mp4$/i.test(u.pathname);
  } catch {
    return false;
  }
}

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
  return d.images?.[0]?.url ?? d.image?.url ?? d.video?.url ?? d.videos?.[0]?.url ?? d.video_url ?? d.audio?.url ?? d.audio_file?.url;
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

/**
 * Prices are always shown as an estimated range, never one exact figure: what
 * the AI services bill can differ a little from our estimate (prompt helpers,
 * exact length, queue retries).
 */
export function costRange(usd: number): [number, number] {
  const low = Math.max(0.01, Math.floor(usd * 0.9 * 100) / 100);
  let high = Math.ceil(usd * 1.15 * 100) / 100;
  if (high <= low) high = low + 0.01;
  return [low, high];
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return "under 1 cent";
  const [low, high] = costRange(usd);
  return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
}

/** One line to show near prices. */
export const COST_NOTE = "Prices are estimates. The final cost may vary slightly.";
