// Better results, behind the scenes.
//
// 1. Picture first: a video made from words starts with a still picture of its
//    first frame. Our checker looks at the still (about a cent) and, if it is
//    clearly wrong, it is made once more with the fix, before any video is paid
//    for. Then the still is animated. The user never sees the extra step.
// 2. Make two, show the best: on premium jobs, two takes are made and the
//    checker picks the better one. For videos the two takes are the cheap
//    first-frame pictures, so only one video is ever paid for.
//
// The costs here are added to the price shown before a job starts, so credits
// always cover them.

import type { Analysis } from "./analyze";
import { estimateCost, getModel, KEYFRAME_MODEL_ID, type ModelInfo } from "./models";
import type { Quality } from "./router";

/** One look at a picture by the checker (fal-ai/any-llm/vision with Gemini Flash). */
export const CHECK_PICTURE_USD = 0.01;

/** Models that are premium on their own; any job made "higher quality" counts too. */
export const PREMIUM_MODEL_IDS = ["kling/v4/text-to-video", "fal-ai/veo3/fast", "fal-ai/flux-pro/v1.1-ultra"];

export function isPremium(modelId: string, quality?: Quality): boolean {
  return quality === "final" || PREMIUM_MODEL_IDS.includes(modelId);
}

/** How many takes to make: two on premium jobs, one otherwise. */
export function takesFor(modelId: string, quality?: Quality): number {
  return isPremium(modelId, quality) ? 2 : 1;
}

/** A video made straight from words (not from a picture, not changing an existing one). */
export function isTextToVideo(m: ModelInfo | undefined): boolean {
  return Boolean(m && m.kind === "video" && !m.takesImage && !m.needsSource);
}

/** A new picture made from words (not a fix, not from the user's own pictures). */
export function isNewImage(m: ModelInfo | undefined): boolean {
  return Boolean(m && m.kind === "image" && !m.needsSource && !m.id.endsWith("/edit"));
}

/**
 * The extra a job costs for the work behind the scenes, in USD.
 * Videos: each first-frame picture and its check (a rare remake of the picture fits inside the price range).
 * Premium pictures: the second take and a check of each.
 */
export function extraCost(m: ModelInfo | undefined, quality?: Quality): number {
  if (!m) return 0;
  const takes = takesFor(m.id, quality);
  if (isTextToVideo(m)) {
    const still = estimateCost(getModel(KEYFRAME_MODEL_ID)!) + CHECK_PICTURE_USD;
    // A remake of the picture only happens when every take is clearly wrong; the range's top covers it.
    return takes * still;
  }
  if (isNewImage(m) && takes > 1) return (takes - 1) * estimateCost(m) + takes * CHECK_PICTURE_USD;
  return 0;
}

/** A job's whole estimated cost: the model's own price plus the work behind the scenes. */
export function jobCost(m: ModelInfo, duration?: number, sound = false, quality?: Quality): number {
  return estimateCost(m, duration, sound) + extraCost(m, quality);
}

/**
 * How bad a check's result is: lower is better. A failed or missing check is
 * treated as unknown, ranked after a clean take but before a clearly wrong one.
 */
export function badness(a: Analysis | null | undefined): number {
  if (!a) return 5;
  return (a.faults?.length ?? 0) * 20 + (a.serious ? 10 : 0) + a.problems.length;
}

/** Index of the best take. Ties go to the first one. */
export function pickBest(checks: (Analysis | null | undefined)[]): number {
  let best = 0;
  checks.forEach((c, i) => {
    if (badness(c) < badness(checks[best])) best = i;
  });
  return best;
}

/** Every take is clearly wrong, so one more picture is worth making with the checker's fix. */
export function allClearlyWrong(checks: (Analysis | null | undefined)[]): boolean {
  return checks.length > 0 && checks.every((c) => Boolean(c?.serious));
}
