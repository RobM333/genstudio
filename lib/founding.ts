// The "Founding 100" sign-up page: one place for the brand name and the offer,
// plus the small rules the page and its API share.

// Name and logo come from lib/appBrand.ts (one place for the whole app).
export { BRAND_NAME, BRAND_LOGO, LOGO_HAS_NAME } from "./appBrand";

/** How many founding spots there are. */
export const TOTAL_SPOTS = 100;

/** What the offer includes. Wording only, nothing here charges anyone. */
export const OFFER = {
  freePlan: "Creator",
  freeCredits: 500,
  freeMonths: 1,
  /** Shown as an estimate: the exact founding price is confirmed before anyone pays. */
  foundingDiscount: "about 30%",
  /** What members drop to if they don't stay on a paid plan. */
  afterPlan: "Free",
  afterCredits: 50,
  /** How many days before the free month ends we send the founding price message. */
  reminderDays: 4,
};

/** The planned founding discount, used only to show estimates. */
export const FOUNDING_DISCOUNT = 0.3;

/** "about $13", the estimated founding price for a plan's monthly price. Never exact: it is confirmed before anyone pays. */
export function foundingPriceText(monthly: number): string {
  return `about $${Math.round(monthly * (1 - FOUNDING_DISCOUNT))}`;
}

/** The sharing reward: for each friend who joins through a member's link, both get this many credits, for up to this many friends. */
export const REFERRAL = { bonus: 100, maxFriends: 5 };

/** Personal invite codes are 8 letters and numbers. */
export function cleanRefCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim();
  return /^[A-Za-z0-9]{8}$/.test(c) ? c : null;
}

/**
 * The inbox an email really goes to, so one person can't count as their own
 * friend: Gmail ignores dots and anything after a "+", and most providers ignore
 * a "+tag".
 */
export function inboxOf(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Well-known throwaway inbox services. Sign-ups from these still work, they just don't earn the sharing reward. */
const THROWAWAY = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamailblock.com", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmail.net", "temp-mail.io", "tempmailo.com",
  "yopmail.com", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "dispostable.com",
  "maildrop.cc", "mailnesia.com", "mintemail.com", "throwawaymail.com", "fakeinbox.com", "emailondeck.com",
  "mohmal.com", "mytemp.email", "tempinbox.com", "spamgourmet.com", "burnermail.io", "moakt.com", "tmail.ws",
  "emailfake.com", "mailcatch.com", "inboxkitten.com", "1secmail.com", "1secmail.net", "dropmail.me", "tempr.email",
  "discard.email", "mail.tm", "mailpoof.com", "33mail.com", "spambox.us", "tempail.com",
]);

export function isThrowawayEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  for (const d of THROWAWAY) if (domain === d || domain.endsWith(`.${d}`)) return true;
  return false;
}

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
