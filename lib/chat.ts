// Reads what someone types in the chat next to a finished picture or video and
// works out which action they mean. Every action is offered with its price first.

export type ChatIntent =
  | { type: "check" }
  | { type: "length"; seconds: number | null } // null = "longer" without a number
  | { type: "final" }
  | { type: "sound" }
  | { type: "video" }
  | { type: "fix"; note: string };

const CHECK =
  /\b(what'?s wrong|whats wrong|find (what'?s wrong|the problems?|problems?|issues?|mistakes?)|check (it|this|for)|any (problems?|issues?|mistakes?)|anything wrong|look for (problems?|issues?|mistakes?)|spot (problems?|mistakes?))\b/i;
const FINAL = /\b(final version|make (the |a )?final|best quality|higher quality|high quality|full quality)\b/i;
const SOUND = /\b(add (some |the )?(sound|audio|music|sound effects)|with sound|needs? sound)\b/i;
const VIDEO = /\b(animate( it| this)?|make (it |this )?(into )?(a )?video|bring (it |this )?to life|turn (it |this )?into (a )?video|make it move)\b/i;
const SECONDS = /\b(\d{1,3})\s*(s|sec|secs|second|seconds)\b/i;
const LONGER = /\b(longer|extend|lengthen)\b/i;

export function readChat(text: string, kind: "image" | "video"): ChatIntent {
  const t = text.trim();
  if (CHECK.test(t)) return { type: "check" };
  if (kind === "video") {
    const n = t.match(SECONDS);
    if (n && /\b(make|made|turn|change|extend|longer|shorter|length)\b/i.test(t)) return { type: "length", seconds: Number(n[1]) };
    if (n && t.split(/\s+/).length <= 3) return { type: "length", seconds: Number(n[1]) };
    if (LONGER.test(t) && t.split(/\s+/).length <= 8) return { type: "length", seconds: null };
    if (SOUND.test(t)) return { type: "sound" };
  }
  if (kind === "image" && VIDEO.test(t)) return { type: "video" };
  if (FINAL.test(t)) return { type: "final" };
  return { type: "fix", note: t };
}

/** The next longer length to suggest for a video. */
export function nextLength(current: number | undefined, lengths: number[]): number {
  const now = current ?? 5;
  return lengths.find((x) => x > now) ?? lengths[lengths.length - 1];
}
