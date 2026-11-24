// Plans and credits (proposed, not on sale yet). Credit prices are worked out
// from what each job costs us at the AI services, so no job loses money even on
// the cheapest credits (the Studio plan, paid yearly).

import { adCost, adPlanWithRules, AD_PRICES } from "./adplan";
import { getModel } from "./models";
import { jobCost } from "./quality";
import { setupCost, talkCost } from "./talk";

export type Feature = { text: string; soon?: boolean };
export type Plan = { id: string; name: string; monthly: number; credits: number; for: string; popular?: boolean; features: Feature[] };

export const YEARLY_DISCOUNT = 0.2;

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    credits: 50,
    for: "Explore AI creation",
    features: [{ text: "Image generation" }, { text: "A few short video clips" }, { text: "Personal projects only" }, { text: "Standard queue" }],
  },
  {
    id: "creator",
    name: "Creator",
    monthly: 19,
    credits: 500,
    for: "For individual creators",
    features: [
      { text: "All image and video models" },
      { text: "Saved characters and people" },
      { text: "Creative director" },
      { text: "Commercial use*" },
      { text: "HD downloads" },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 49,
    credits: 1500,
    for: "For serious creators",
    popular: true,
    features: [
      { text: "Everything in Creator" },
      { text: "Full ads with voiceover and music" },
      { text: "Director's notes and automatic quality check" },
      { text: "Multi-shot videos up to 30 seconds" },
      { text: "Brand kit" },
      { text: "Several brand kits", soon: true },
      { text: "Priority generation", soon: true },
      { text: "Full HD downloads", soon: true },
    ],
  },
  {
    id: "studio",
    name: "Studio",
    monthly: 149,
    credits: 5000,
    for: "For teams and agencies",
    features: [
      { text: "Everything in Pro" },
      { text: "Team members", soon: true },
      { text: "Shared credit pool", soon: true },
      { text: "Client projects", soon: true },
      { text: "Advanced editing", soon: true },
    ],
  },
];

export function planPrice(p: Plan, yearly: boolean): number {
  return yearly ? Math.round(p.monthly * (1 - YEARLY_DISCOUNT) * 100) / 100 : p.monthly;
}

/** The least a credit earns: the Studio plan paid yearly. */
export const LOWEST_CREDIT_PRICE = Math.min(...PLANS.filter((p) => p.monthly > 0).map((p) => planPrice(p, true) / p.credits));

/**
 * What one credit may cost us. About half the lowest credit price, which leaves
 * room for card fees, failed jobs that are retried, the free plan and price changes.
 */
export const CREDIT_COST_USD = 0.012;

/** Our estimates can be a little low: credits are worked out from the top of the range. */
export const COST_MARGIN = 1.15;

/** Credits for a job, from the top of its estimated cost range, rounded up to a tidy number. */
export function creditsFor(usd: number): number {
  const raw = (usd * COST_MARGIN) / CREDIT_COST_USD;
  if (raw <= 10) return Math.max(1, Math.ceil(raw));
  if (raw <= 50) return Math.ceil(raw / 5) * 5;
  return Math.ceil(raw / 10) * 10;
}

/** Example jobs and their credits, worked out from today's model prices. */
export function creditExamples(): { what: string; usd: number; credits: number }[] {
  const m = (id: string) => getModel(id)!;
  const ad = (seconds: number) => adCost(adPlanWithRules({ product: "A product", audience: "", seconds, tone: "Friendly" }), false, true);
  const rows: { what: string; usd: number }[] = [
    // jobCost includes the work behind the scenes: a checked first picture for every video, and two takes on premium jobs.
    { what: "Fast image (FLUX Schnell)", usd: jobCost(m("fal-ai/flux/schnell")) },
    { what: "Standard image (Nano Banana)", usd: jobCost(m("fal-ai/nano-banana")) },
    { what: "Premium image, best of 2 (FLUX Ultra)", usd: jobCost(m("fal-ai/flux-pro/v1.1-ultra")) },
    { what: "Short video, 6s (Hailuo 02)", usd: jobCost(m("fal-ai/minimax/hailuo-02/standard/text-to-video"), 6, false) },
    { what: "Short video with sound, 5s (Kling 2.5)", usd: jobCost(m("fal-ai/kling-video/v2.5-turbo/pro/text-to-video"), 5, true) },
    { what: "Longer video with sound, 10s (Kling 2.5)", usd: jobCost(m("fal-ai/kling-video/v2.5-turbo/pro/text-to-video"), 10, true) },
    { what: "Premium video with speech, 8s (Veo 3 Fast)", usd: jobCost(m("fal-ai/veo3/fast"), 8, true) },
    { what: "Premium video with sound, 10s (Kling 4)", usd: jobCost(m("kling/v4/text-to-video"), 10, true) },
    { what: "Sharpen a video to HD, 10s", usd: 10 * 0.02 },
    { what: "Character set (4 pictures of one person)", usd: 4 * AD_PRICES.picture + 0.01 },
    { what: "Voiceover line (about 100 characters)", usd: (100 / 1000) * AD_PRICES.voicePer1000Chars },
    { what: "You, talking: set up your voice copy (once)", usd: setupCost() },
    { what: "You, talking: 15 seconds in your own voice", usd: talkCost(15) },
    { what: "Full ad, 15 seconds", usd: ad(15) },
    { what: "Full ad, 30 seconds", usd: ad(30) },
    { what: "Full ad, 60 seconds", usd: ad(60) },
  ];
  return rows.map((r) => ({ ...r, credits: creditsFor(r.usd) }));
}
