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
  aspectRatios: AspectRatio[];
  buildInput: (opts: { prompt: string; aspectRatio: AspectRatio; duration?: number }) => Record<string, unknown>;
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
    id: "fal-ai/imagen4/preview",
    name: "Google Imagen 4",
    kind: "image",
    tagline: "Strong at text in images and clean product shots.",
    approxCost: "~$0.05 / image",
    aspectRatios: ["1:1", "16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
    }),
  },
  {
    id: "fal-ai/recraft/v3/text-to-image",
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
    name: "Google Veo 3 Fast",
    kind: "video",
    tagline: "Top quality, with sound.",
    approxCost: "~$0.40 / second",
    durations: [8],
    aspectRatios: ["16:9", "9:16"],
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration: "8s",
      generate_audio: true,
    }),
  },
];

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
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

/** Rough cost of one job in USD. */
export function estimateCost(model: ModelInfo, duration?: number): number {
  const unit = unitPrice(model);
  return model.kind === "video" ? unit * (duration ?? model.durations?.[0] ?? 5) : unit;
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? "under 1 cent" : "~$" + usd.toFixed(2);
}
