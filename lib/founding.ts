// The "Founding 100" sign-up page: one place for the brand name and the offer,
// plus the small rules the page and its API share.

// Name and logo come from lib/appBrand.ts (one place for the whole app).
export { BRAND_NAME, BRAND_LOGO, BRAND_LOGO_SIZE, LOGO_HAS_NAME } from "./appBrand";

/** How many founding spots there are. */
export const TOTAL_SPOTS = 100;

/** What the offer includes. Wording only, nothing here charges anyone. */
export const OFFER = {
  freePlan: "Creator",
  freeCredits: 500,
  freeMonths: 1,
  /** Shown as an estimate: the exact founding price is confirmed before anyone pays. */
  foundingDiscount: "about 30%",
};

/** Optional answer to "What would you make first?" */
export const MAKES = [
  "Product photos",
  "Video ads",
  "Social posts and short videos",
  "Brand visuals (banners, call backgrounds)",
  "Something else",
] as const;

export type FoundingSignup = {
  email: string;
  name: string;
  makes: string;
  at: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trims and lower-cases an email. Returns null when it doesn't look like one. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Short, plain text for the optional fields. */
export function cleanText(raw: unknown, max = 80): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
}

/** Only accept one of the listed answers. */
export function cleanMakes(raw: unknown): string {
  return typeof raw === "string" && (MAKES as readonly string[]).includes(raw) ? raw : "";
}

/** Founding spots still open, never below zero. */
export function spotsLeft(taken: number): number {
  return Math.max(0, TOTAL_SPOTS - Math.max(0, Math.floor(taken)));
}

/** "73 of 100 founding spots left", or the line shown once they are all taken. */
export function spotsLine(left: number): string {
  if (left <= 0) return `All ${TOTAL_SPOTS} founding spots are taken`;
  if (left === 1) return `1 of ${TOTAL_SPOTS} founding spots left`;
  return `${left} of ${TOTAL_SPOTS} founding spots left`;
}

/** Most sign-ups we accept from one connection in a day, to stop someone filling the list with fake emails. */
export const MAX_PER_IP_PER_DAY = 5;
