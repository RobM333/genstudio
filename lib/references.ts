// The user's own reference pictures: a product photo, a logo, or a person who
// agreed to be shown. They are uploaded to fal's file storage, checked by an AI
// for things we never allow (children, nudity, gore), and only then signed so
// the generate step can trust them. There are no accounts yet, so the list of
// references lives in the user's browser.

import { createHmac, timingSafeEqual } from "node:crypto";

export type RefKind = "product" | "logo" | "person" | "style";
export const REF_KINDS: RefKind[] = ["product", "logo", "person", "style"];
export type Reference = { url: string; kind: RefKind; token: string; name?: string };

export const MAX_REFS = 4;
export const MAX_REF_BYTES = 4 * 1024 * 1024; // keeps the upload under the hosting body limit
export const REF_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function isRefKind(k: unknown): k is RefKind {
  return typeof k === "string" && (REF_KINDS as string[]).includes(k);
}

function secret(): string {
  // Derived from server-only secrets, so nobody can forge a "checked" reference.
  return process.env.REF_SECRET || `${process.env.FAL_KEY ?? ""}|${process.env.APP_PASSWORD ?? ""}|genstudio-refs`;
}

export function sign(...parts: string[]): string {
  return createHmac("sha256", secret()).update(parts.join("\n")).digest("base64url");
}

export function verify(token: string, ...parts: string[]): boolean {
  const want = Buffer.from(sign(...parts));
  const got = Buffer.from(String(token ?? ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** What the checking AI looks for. Children are never allowed in uploads. */
export function refCheckInstructions(kind: RefKind): string {
  return `You check pictures that users upload to an ad generator, before they are used. The user says this is: ${kind === "person" ? "a photo of a person (who agreed to be used)" : kind === "logo" ? "their logo" : kind === "style" ? "a style reference" : "a product photo"}.
Answer these about the picture:
- minor: does it show anyone who could be under 18 (a child, a baby or a teenager)?
- nudity: does it show nudity, underwear-only, or sexual content?
- gore: does it show graphic violence, gore or weapons pointed at people?
- people: how many people are visible (0 if none)?
- matches: does it plausibly match what the user says it is?
Reply with JSON only: {"minor": false, "nudity": false, "gore": false, "people": 0, "matches": true}`;
}

export type RefCheck = { ok: true } | { ok: false; reason: string };

export function judgeRefCheck(raw: string, kind: RefKind): RefCheck {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, reason: "We couldn't check this picture. Please try again." };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "We couldn't check this picture. Please try again." };
  }
  if (j.minor !== false) return { ok: false, reason: "Pictures of children can't be used as references. This keeps young people safe." };
  if (j.nudity !== false) return { ok: false, reason: "This picture can't be used: it looks like it contains nudity or sexual content." };
  if (j.gore !== false) return { ok: false, reason: "This picture can't be used: it looks violent or graphic." };
  const people = Number(j.people) || 0;
  if (kind === "person" && people < 1) return { ok: false, reason: "We couldn't see a person in this picture. Try a clear photo of one face." };
  if (kind === "person" && people > 1) return { ok: false, reason: "Please use a photo of just one person, so we know who agreed to it." };
  return { ok: true };
}

const LABEL: Record<RefKind, string> = {
  product: "the user's product",
  logo: "the user's logo",
  person: "the person to feature",
  style: "the look and style to follow",
};

/** Tells the picture model how to use each reference picture, in order. */
export function referenceInstructions(kinds: RefKind[]): string {
  const lines = kinds.map((k, i) => {
    const what = LABEL[k];
    const how =
      k === "product"
        ? "keep its exact shape, colours, materials, label and any text"
        : k === "logo"
          ? "reproduce it exactly, same shapes, colours and lettering, placed where it naturally belongs (on the product, a sign or a corner), not distorted"
          : k === "person"
            ? "keep the same face and identity; same age; dressed appropriately; no change to body shape"
            : "match its colours, lighting and mood, but not its content";
    return `Image ${i + 1} is ${what}: ${how}.`;
  });
  return `${lines.join(" ")} Build a new, realistic scene around them as described next. Lighting, shadows, reflections and perspective on them must match the new scene.`;
}
