// How many credits each piece of real AI work takes from a person's balance.
// The price shown before a job is a rounded-up estimate (lib/pricing.ts). The
// balance is charged for each step as it starts, at the same rate but without
// the rounding up, so what comes off is about the estimate or a little under.
// Failed steps are given back automatically.

import { CREDIT_COST_USD, COST_MARGIN } from "../pricing";
import {
  CARD_MOTION_MODEL,
  COMPOSE_MODEL,
  estimateCost,
  LAST_FRAME_MODEL,
  MERGE_VIDEOS_MODEL,
  MUSIC_MODEL,
  unitPrice,
  VOICE_MODEL,
  type ModelInfo,
} from "../models";
import { TALK_PRICES, MAX_TALK_SECONDS, talkSeconds } from "../talk";

/** Credits for a cost in USD, to one decimal place, never less than 0.1. */
export function creditsForUsd(usd: number): number {
  if (!(usd > 0)) return 0;
  return Math.max(0.1, Math.round(((usd * COST_MARGIN) / CREDIT_COST_USD) * 10) / 10);
}

/** A balance as people see it: whole credits, rounded down. */
export function shownCredits(balance: number): number {
  return Math.max(0, Math.floor(balance + 1e-9));
}

/**
 * One /api/generate step. Silent models get their sound in a separate step
 * (the add-sound model), which is charged on its own, so it isn't counted here.
 */
export function generateUsd(model: ModelInfo, duration: number | undefined, sound: boolean): number {
  return estimateCost(model, duration, model.audio ? sound : false);
}

/** One /api/tool step (storyboards and full ads). */
export function toolUsd(tool: string, opts: { seconds?: number; text?: string }): number {
  const secs = Math.max(1, opts.seconds ?? 5);
  switch (tool) {
    case "voice":
      return ((opts.text ?? "").length / 1000) * unitPrice(VOICE_MODEL);
    case "music":
      return (secs / 60) * unitPrice(MUSIC_MODEL);
    case "card":
      return secs * unitPrice(CARD_MOTION_MODEL);
    case "mix":
      return secs * unitPrice(COMPOSE_MODEL);
    case "merge":
      return unitPrice(MERGE_VIDEOS_MODEL);
    case "last-frame":
      return unitPrice(LAST_FRAME_MODEL);
    default:
      return 0;
  }
}

/** "You, talking": reading the words in the person's voice. */
export function talkSpeechUsd(text: string): number {
  return (text.length / 1000) * TALK_PRICES.speechPer1000Chars;
}

/** "You, talking": the talking video, from how long the words take to say. */
export function talkVideoUsd(text: string): number {
  const secs = Math.min(MAX_TALK_SECONDS, talkSeconds(text || "a few words"));
  return Math.max(3, secs) * TALK_PRICES.videoPerSecond;
}

/** "You, talking": the one-time voice copy (the consent check is on us). */
export function voiceCopyUsd(): number {
  return TALK_PRICES.clone;
}
