// The "no wasted credits" promise: pay only for videos that work.
//
// When a job fails outright, or our own automatic check finds a clear fault, the
// credits for it come back. "Clear" means a fault anyone can confirm with a yes
// or no by looking or listening. Taste and style ("I don't like the colours")
// are never covered. A serious problem that isn't on the list (borderline) gets
// a free remake offer instead of an argument about whether it counts.
//
// Refunds for check-found faults and free remakes are capped per person each
// month, so the promise can't be abused. Failed jobs don't count toward the cap,
// because the AI services don't bill us for them.
//
// There are no accounts or credit balances yet, so today the record of what was
// used and returned lives in the browser (see components/creditLog.ts). When
// accounts arrive, the same decisions are made on the server and the record moves
// to the account.

/**
 * Whether the promise is advertised (home page line and Pricing section). Off
 * until the checks have been tested on real videos and Rob has seen the
 * results, so we never promise more than the checks catch. The checks and
 * refunds run either way. The Pricing section can be previewed at
 * /pricing?preview=promise.
 */
export const ADVERTISE_PROMISE = false;

export type FaultCode = "failed" | "garbled_text" | "unwanted_speech" | "product_changed" | "missing_item";

/** The faults the promise covers, in plain words people can read on the Pricing page. */
export const FAULTS: { code: FaultCode; text: string; example: string }[] = [
  { code: "failed", text: "The job didn't finish", example: "The AI service stopped with an error, timed out or refused it." },
  { code: "garbled_text", text: "Words on screen are misspelled or garbled", example: "You asked for \"SUMMER SALE\" and it says \"SUMMR SAEL\", or the letters are scrambled." },
  { code: "unwanted_speech", text: "Someone talks when you didn't ask for speech", example: "You asked for sound effects or music only, and a voice says words." },
  { code: "product_changed", text: "Your product or logo changes", example: "The bottle changes shape, colour or label partway through, or between scenes." },
  { code: "missing_item", text: "Something you named is missing", example: "You asked for a dog on the sofa and there is no dog." },
];

export const COVERED_CODES: FaultCode[] = FAULTS.map((f) => f.code);

export function faultText(code: FaultCode): string {
  return FAULTS.find((f) => f.code === code)?.text ?? "A clear fault";
}

/** What isn't covered, said plainly. */
export const NOT_COVERED = [
  "Taste and style, like colours, mood, camera choices or how a person looks",
  "Small flaws that don't stop you using it",
  "Results that match what was typed, even if it wasn't what you meant",
];

/** Refunds for check-found faults plus free remakes, per person, each calendar month. */
export const MONTHLY_CAP = 10;

export type PromiseOutcome =
  | { type: "refund"; fault: FaultCode; reason: string } // credits come back automatically
  | { type: "free_remake"; reason: string } // borderline: offer one remake on us
  | { type: "capped"; fault?: FaultCode; reason: string } // would qualify, but this month's limit is used up
  | { type: "none" };

export type CheckResult = { faults?: string[]; problems?: string[]; serious?: boolean } | null;

/** Keeps only the fault codes the promise covers. */
export function cleanFaults(raw: unknown): FaultCode[] {
  if (!Array.isArray(raw)) return [];
  const out: FaultCode[] = [];
  for (const f of raw) if (typeof f === "string" && (COVERED_CODES as string[]).includes(f) && f !== "failed" && !out.includes(f as FaultCode)) out.push(f as FaultCode);
  return out;
}

/**
 * Decides what the promise does for one finished or failed job.
 * usedThisMonth counts refunds for check-found faults and free remakes already given this month.
 */
export function decide(opts: { failed?: boolean; check?: CheckResult; usedThisMonth: number; cap?: number }): PromiseOutcome {
  const cap = opts.cap ?? MONTHLY_CAP;
  if (opts.failed) return { type: "refund", fault: "failed", reason: faultText("failed") };
  const c = opts.check;
  if (!c) return { type: "none" };
  const faults = cleanFaults(c.faults);
  if (faults.length) {
    if (opts.usedThisMonth >= cap) return { type: "capped", fault: faults[0], reason: faultText(faults[0]) };
    return { type: "refund", fault: faults[0], reason: faultText(faults[0]) };
  }
  if (c.serious && c.problems?.length) {
    if (opts.usedThisMonth >= cap) return { type: "capped", reason: c.problems[0] };
    return { type: "free_remake", reason: c.problems[0] };
  }
  return { type: "none" };
}

/** Did the person ask for anyone to speak? If not, a voice saying words is a fault. */
export function asksForSpeech(prompt: string): boolean {
  return /["“”].{2,}["“”]|\b(say|says|said|saying|speak|speaks|speaking|speech|talk|talks|talking|dialog|dialogue|voice ?over|voiceover|narrat\w*|announce\w*|sing|sings|singing|song|lyrics|interview|conversation|presenter|tells|shout\w*|whisper\w*)\b/i.test(
    prompt,
  );
}

// Speech-to-text often "hears" these on silence or music, so they never count as speech.
const PHANTOM = /^(thank you|thanks for watching|you|bye|music|applause|oh|ah|uh|hmm|subtitles by.*|\W*)$/i;

/** A transcript counts as unwanted speech only when there are a few real words in it. */
export function isRealSpeech(transcript: string): boolean {
  const t = transcript.replace(/\[[^\]]*\]|\([^)]*\)|♪/g, " ").trim();
  if (!t || PHANTOM.test(t.replace(/[.!?,]+$/g, "").trim())) return false;
  const words = t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length >= 4;
}

/** The month key a refund is counted in, e.g. "2026-11". */
export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** One line in the record of credits used and returned. Ready to move to an account later. */
export type CreditEntry = {
  at: number;
  itemId: string;
  type: "used" | "returned" | "free_remake";
  credits: number;
  what: string; // e.g. "Kling 2.5 video, 10s" or the fault in plain words
  fault?: FaultCode;
};

/** How many capped promise actions (check-found refunds and free remakes) were given in this month. */
export function usedInMonth(entries: CreditEntry[], at: number): number {
  const m = monthKey(at);
  return entries.filter((e) => monthKey(e.at) === m && (e.type === "free_remake" || (e.type === "returned" && e.fault !== "failed"))).length;
}

/** Credits already returned for this job, so a job is never refunded twice. */
export function alreadyReturned(entries: CreditEntry[], itemId: string): boolean {
  return entries.some((e) => e.itemId === itemId && e.type === "returned");
}

/** The plain-words note shown under a result the promise covered. */
export function promiseNote(o: PromiseOutcome): string | null {
  if (o.type === "refund")
    return o.fault === "failed"
      ? "This one didn't finish, so it costs you nothing. The credits for it come straight back."
      : `Our check found a clear fault: ${o.reason.toLowerCase()}. Under our no wasted credits promise, the credits for it come straight back.`;
  if (o.type === "free_remake") return `Our check spotted a problem: ${o.reason.replace(/\.$/, "")}. You can have one remake on us.`;
  if (o.type === "capped")
    return `Our check spotted a problem: ${o.reason.replace(/\.$/, "").toLowerCase()}. This month's ${MONTHLY_CAP} automatic refunds and free remakes are used up, so this one is charged as normal.`;
  return null;
}
