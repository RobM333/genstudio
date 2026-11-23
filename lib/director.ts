// The creative director: reads a short video idea and proposes three ways to
// shoot it, each a finished, directed prompt (shot, lens, camera move, light,
// colour, pacing and the ending frame) with a suggested length and shape.
// It can also ask up to two questions that would make the video better.
// About a tenth of a cent per call; simple rules when the AI can't be reached.

import { brandLine, type BrandInfo } from "./brand";

export type Direction = { name: string; why: string; prompt: string; seconds: number; shape: "16:9" | "9:16" | "1:1" };
export type DirectorReply = { read: string; questions: string[]; directions: Direction[] };

export const DIRECTOR_LENGTHS = [5, 10, 15, 20, 30];
const SHAPES = ["16:9", "9:16", "1:1"] as const;

export function directorInstructions(kind: "image" | "video", brand?: BrandInfo): string {
  const b = brandLine(brand);
  const video = kind === "video";
  return `You are an award-winning creative director for short social ${video ? "videos" : "pictures"} made with AI generators. A creator or marketer gives you a rough idea.
1. "read": one short sentence, in plain words, saying what you think they want and who it is for.
2. "questions": up to 2 short questions whose answers would clearly improve it (for example who it's for, the product's look, the mood, where it's shown). Empty if the idea is already clear. Never ask about things you can decide yourself.
3. "directions": exactly 3 different ways to make it, from safe to bold, for example "Cinematic hero", "Real and handheld" (UGC style), "Bold and playful". Each has:
   - "name": 2 to 4 words.
   - "why": one sentence on why it works and where it works best.
   - "prompt": the full ${video ? "video" : "picture"} prompt, 60 to 120 words, keeping everything the user asked for. State the shot type and lens (for example "35mm medium shot"), the camera position${video ? " and one clear camera move" : ""}, what is in the foreground and background and which way each person or object faces, where the light comes from and its colour, the colour palette${video ? ", the pacing, the one main action in order, and the final frame (what we end on)" : ""}. Anything that breaks, spills or changes stays that way. ${video ? "If a direction needs more than one moment, describe the shots in order with timings and pick a length to fit." : ""}
   ${video ? "" : "- A picture is ONE frame from ONE camera position: never write cuts, a second shot, a sequence or things happening one after another.\n   "}${video ? `- "seconds": one of ${DIRECTOR_LENGTHS.join(", ")}. 5 for one simple moment, 10 for a moment with a reveal, 15 to 30 only when several shots are needed.` : `- "seconds": 0.`}
   - "shape": "9:16" for TikTok, Reels and Shorts, "1:1" for the Instagram feed, "16:9" for YouTube and websites. Pick what suits the direction.
Rules: no real people, celebrities, brands, teams, jersey numbers or logos unless the user owns them (describe people generically). No words or captions inside the picture unless the user asked for them, spelled exactly. Adults only. No nudity, gore or violence.${b ? `\nThe user's brand kit: ${b}. Use its colours and style in every direction.` : ""}
Reply with JSON only: {"read":"...","questions":["..."],"directions":[{"name":"...","why":"...","prompt":"...","seconds":5,"shape":"9:16"}]}`;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function parseDirector(raw: string, kind: "image" | "video"): DirectorReply | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const directions = (Array.isArray(j.directions) ? j.directions : [])
      .map((d) => {
        const o = (d ?? {}) as Record<string, unknown>;
        const secs = Number(o.seconds);
        const fit = DIRECTOR_LENGTHS.reduce((a, b) => (Math.abs(b - secs) < Math.abs(a - secs) ? b : a), 5);
        return {
          name: clip(o.name, 40) || "Direction",
          why: clip(o.why, 200),
          prompt: clip(o.prompt, 1500),
          seconds: kind === "video" ? fit : 0,
          shape: (SHAPES as readonly string[]).includes(String(o.shape)) ? (String(o.shape) as Direction["shape"]) : "16:9",
        };
      })
      .filter((d) => d.prompt.length > 30)
      .slice(0, 3);
    if (directions.length === 0) return null;
    const questions = (Array.isArray(j.questions) ? j.questions : []).map((q) => clip(q, 160)).filter(Boolean).slice(0, 2);
    return { read: clip(j.read, 240), questions, directions };
  } catch {
    return null;
  }
}

/** Three plain directions when the AI can't be reached. */
export function directorWithRules(idea: string, kind: "image" | "video", brand?: BrandInfo): DirectorReply {
  const base = idea.trim().replace(/[.!?\s]+$/, "");
  const b = brandLine(brand);
  const tail = b ? ` Colours and style: ${b.replace(/^Brand name: [^;]+; ?/, "")}.` : "";
  const v = kind === "video";
  return {
    read: `A short ${v ? "video" : "picture"}: ${base.slice(0, 160)}.`,
    questions: [],
    directions: [
      {
        name: "Cinematic hero",
        why: "Polished and premium, works everywhere.",
        prompt: `${base}. 50mm medium shot at eye level${v ? ", slow push-in" : ""}. Soft warm key light from the left, gentle rim light, shallow depth of field, clean background. Rich, natural colours.${v ? " One clear action, smooth and unhurried, ending on a steady close-up." : ""}${tail}`,
        seconds: v ? 5 : 0,
        shape: "16:9",
      },
      {
        name: "Real and handheld",
        why: "Feels like a real person filmed it, which suits TikTok and Reels.",
        prompt: `${base}. Shot on a phone, vertical, handheld at chest height${v ? " with natural small movements" : ""}. Daylight from a window, true-to-life colours, casual real setting.${v ? " Quick and natural, ending on the main subject facing the camera." : ""}${tail}`,
        seconds: v ? 5 : 0,
        shape: "9:16",
      },
      {
        name: "Bold and playful",
        why: "Bright and eye-catching, made to stop the scroll.",
        prompt: `${base}. Wide-angle 24mm, low angle${v ? ", fast dolly-in" : ""}. Bright saturated colours, hard light from above with crisp shadows, simple bold background.${v ? " Snappy pacing, a surprising reveal, ending on a punchy close-up." : ""}${tail}`,
        seconds: v ? 5 : 0,
        shape: "1:1",
      },
    ],
  };
}
