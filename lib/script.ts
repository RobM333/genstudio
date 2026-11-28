// Script to Video: the person pastes their own script (any length, even 10+
// minutes) and keeps every word. The script is cut into short lines, each line
// gets one planned shot, and the person sees every line beside its shot, with
// an estimated price range, before anything is paid for.
//
// Each shot comes from one of four places:
//   ai    - a fresh AI video shot (a first frame, then Kling brings it to life)
//   stock - a free stock video (Pexels or Pixabay)
//   still - an AI picture with a slow zoom or pan (cheap)
//   mine  - one of the person's own uploaded clips
// The look sets them all at once (All AI, Mix, Budget) and any shot can be swapped.

import { AD_VOICES, DEFAULT_VOICE } from "./adplan";
import type { AspectRatio } from "./models";

export const SCRIPT_NAME = "Script to Video";

export type ShotSource = "ai" | "stock" | "still" | "mine";
export type ScriptLook = "ai" | "mix" | "budget";

/** One stock video the shot can use, with who made it (shown beside it, as the stock sites ask). */
export type StockPick = {
  provider: "pexels" | "pixabay";
  id: string;
  url: string; // the mp4 file
  thumb: string;
  width: number;
  height: number;
  seconds: number;
  by: string;
  page: string; // the clip's page on the stock site
};

export type ScriptBeat = {
  text: string; // the person's exact words for this line, never changed
  visual: string; // the shot planned under it (the person can edit it)
  search: string; // a few words to find a stock video for it
  key?: boolean; // a key moment: the planner thinks it needs a fresh AI shot
  source: ShotSource;
  /** The person picked this source themselves, so changing the look leaves it alone. */
  pinned?: boolean;
  stock?: StockPick;
  stockTried?: string; // the search words a stock search already ran for (so it isn't repeated)
  clip?: number; // which of the person's own clips (index into ScriptJob.clips)
  keepSound?: boolean; // their own clip keeps its sound, and its line isn't read over it
};

export type ScriptPlan = {
  title: string;
  look: string; // what stays the same in every AI shot: people, setting, colours, light
  music: string;
  beats: ScriptBeat[];
};

export type VoiceChoice =
  | { kind: "stock"; voice: string } // one of our voices
  | { kind: "eleven"; voice: string } // the person's own ElevenLabs voice ("el:<id>")
  | { kind: "recording"; url: string; seconds: number; name: string }; // their own recording of the script

export type MyClip = { url: string; name: string; seconds: number };

export const MAX_SCRIPT_CHARS = 30000; // about 30 minutes of talking
export const MAX_BEATS = 400;
export const PLAN_BATCH = 30; // lines planned per planner call
export const SECTION_SIZE = 12; // shots joined per section, then the sections are joined
export const MAX_CLIPS = 12;
export const MAX_CLIP_BYTES = 200 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
export const WORDS_PER_SECOND = 2.5;

const MIN_WORDS = 6;
const MAX_WORDS = 16;

/** Tidies spaces (the words themselves are never changed). Paragraphs stay apart. */
export function tidyScript(text: string): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_SCRIPT_CHARS);
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Cuts a long sentence at a comma near the middle, or else into even pieces, so each piece fits one shot. */
function cutLong(sentence: string): string[] {
  const words = sentence.split(" ").filter(Boolean);
  if (words.length <= MAX_WORDS) return [sentence];
  // Prefer a natural pause (a comma, semicolon, colon or dash) near the middle.
  const mid = words.length / 2;
  let best = -1;
  for (let i = MIN_WORDS - 1; i < words.length - MIN_WORDS; i++) {
    if (/[,;:–—]$/.test(words[i]) || words[i + 1] === "—" || words[i + 1] === "-") {
      if (best === -1 || Math.abs(i + 1 - mid) < Math.abs(best + 1 - mid)) best = i;
    }
  }
  if (best >= 0) {
    return [...cutLong(words.slice(0, best + 1).join(" ")), ...cutLong(words.slice(best + 1).join(" "))];
  }
  const parts = Math.ceil(words.length / 12);
  const size = Math.ceil(words.length / parts);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(" "));
  return out;
}

/**
 * Splits a script into lines of about 6 to 16 words (2 to 6 seconds of talking),
 * one shot each. Joined back with spaces, the lines are exactly the script.
 */
export function splitScript(text: string): string[] {
  const lines: string[] = [];
  for (const para of tidyScript(text).split("\n\n")) {
    const sentences = para.match(/[^.!?…]+(?:[.!?…]+["”’')\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [para];
    const out: string[] = [];
    for (const p of sentences.flatMap(cutLong)) {
      const prev = out[out.length - 1];
      if (prev && countWords(prev) < MIN_WORDS && countWords(prev) + countWords(p) <= MAX_WORDS) out[out.length - 1] = `${prev} ${p}`;
      else out.push(p);
    }
    // A short line left over joins the line before it (or after it) in the same paragraph.
    for (let i = 0; i < out.length; i++) {
      if (countWords(out[i]) >= MIN_WORDS || out.length < 2) continue;
      if (i > 0 && countWords(out[i - 1]) + countWords(out[i]) <= MAX_WORDS) {
        out[i - 1] = `${out[i - 1]} ${out[i]}`;
        out.splice(i--, 1);
      } else if (i + 1 < out.length && countWords(out[i]) + countWords(out[i + 1]) <= MAX_WORDS) {
        out[i + 1] = `${out[i]} ${out[i + 1]}`;
        out.splice(i--, 1);
      }
    }
    lines.push(...out);
  }
  return lines.slice(0, MAX_BEATS);
}

/** About how long a line takes to say, in seconds. */
export function beatSeconds(text: string): number {
  return Math.min(9, Math.max(1.5, countWords(text) / WORDS_PER_SECOND + 0.3));
}

export function scriptSeconds(beats: { text: string }[]): number {
  return beats.reduce((t, b) => t + beatSeconds(b.text), 0);
}

export function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} seconds`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

// ---------- the looks ----------

export const LOOKS: { id: ScriptLook; label: string; hint: string }[] = [
  { id: "ai", label: "All AI", hint: "A fresh AI video shot under every line. The most striking, and the dearest." },
  { id: "mix", label: "Mix", hint: "AI video for the key moments, free stock video for the rest." },
  { id: "budget", label: "Budget", hint: "Free stock video, plus AI pictures with a slow zoom or pan where no stock fits." },
];

/** Which source a line gets under a look (the person can still swap any line). */
export function sourceFor(look: ScriptLook, beat: Pick<ScriptBeat, "key">, i: number, stockOn: boolean): ShotSource {
  if (look === "ai") return "ai";
  if (look === "mix") return i === 0 || beat.key ? "ai" : stockOn ? "stock" : "still";
  return stockOn ? "stock" : "still";
}

/** Gives every line the look's source, except lines the person set themselves. */
export function applyLook(plan: ScriptPlan, look: ScriptLook, stockOn: boolean): ScriptPlan {
  return { ...plan, beats: plan.beats.map((b, i) => (b.pinned ? b : { ...b, source: sourceFor(look, b, i, stockOn) })) };
}

// ---------- prices (always shown as a range) ----------

export const SCRIPT_PRICES = {
  frame: 0.04, // Nano Banana: an AI shot's first frame, or a still
  aiShot5: 0.35, // Kling 2.5 Turbo Pro, 5 seconds
  aiShot10: 0.7, // Kling 2.5 Turbo Pro, 10 seconds
  stillMovePerSecond: 0.02, // the slow zoom or pan on a still
  joinPerSecond: 0.0002 * 3, // joining sections and the final mix
  voicePer1000Chars: 0.05,
  musicBed: 0.02, // one minute of music, repeated under longer videos
  captionsPerMinute: 0.03,
  transcribePerMinute: 0.02, // lining up the person's own recording with the lines
  planPerBatch: 0.002,
};

/** What one line's shot costs. Stock and the person's own clips are free. */
export function shotCost(source: ShotSource, seconds: number): number {
  if (source === "ai") return SCRIPT_PRICES.frame + (seconds > 5 ? SCRIPT_PRICES.aiShot10 : SCRIPT_PRICES.aiShot5);
  if (source === "still") return SCRIPT_PRICES.frame + seconds * SCRIPT_PRICES.stillMovePerSecond;
  return 0;
}

export type ExtrasChoice = { voice: VoiceChoice["kind"]; captions: boolean; music: boolean };

/** Voice, music, captions and joining: what the video costs on top of its shots. */
export function extrasCost(beats: { text: string }[], extras: ExtrasChoice): number {
  const secs = scriptSeconds(beats);
  const chars = beats.reduce((n, b) => n + b.text.length, 0);
  return (
    (extras.voice === "stock" ? (chars / 1000) * SCRIPT_PRICES.voicePer1000Chars : 0) + // an ElevenLabs voice is billed to their own ElevenLabs
    (extras.voice === "recording" ? Math.ceil(secs / 60) * SCRIPT_PRICES.transcribePerMinute : 0) +
    (extras.music ? SCRIPT_PRICES.musicBed : 0) +
    (extras.captions ? Math.ceil(secs / 60) * SCRIPT_PRICES.captionsPerMinute : 0) +
    secs * SCRIPT_PRICES.joinPerSecond
  );
}

/** The whole video as planned. */
export function scriptCost(plan: { beats: Pick<ScriptBeat, "text" | "source">[] }, extras: ExtrasChoice): number {
  return plan.beats.reduce((t, b) => t + shotCost(b.source, beatSeconds(b.text)), 0) + extrasCost(plan.beats, extras);
}

/**
 * A look's price before the shots are planned: a low and a high estimate, because
 * which lines are key moments, and which find stock video, is only known later.
 */
export function lookRange(lines: string[], look: ScriptLook, extras: ExtrasChoice, stockOn: boolean): [number, number] {
  const secs = lines.map(beatSeconds);
  const ai = secs.reduce((t, s) => t + shotCost("ai", s), 0);
  const still = secs.reduce((t, s) => t + shotCost("still", s), 0);
  const base = extrasCost(lines.map((text) => ({ text })), extras) + Math.ceil(lines.length / PLAN_BATCH) * SCRIPT_PRICES.planPerBatch;
  const range = (lo: number, hi: number): [number, number] => [Math.max(0.01, Math.floor((base + lo) * 0.9 * 100) / 100), Math.ceil((base + hi) * 1.15 * 100) / 100];
  if (look === "ai") return range(ai, ai);
  if (look === "mix") {
    if (!stockOn) return range(ai * 0.2 + still * 0.8, ai * 0.35 + still * 0.65);
    return range(ai * 0.2, ai * 0.35);
  }
  if (!stockOn) return range(still, still);
  return range(still * 0.15, still * 0.5);
}

export function formatRange([lo, hi]: [number, number]): string {
  const f = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
  return hi < 0.01 ? "under 1 cent" : `${f(lo)}–${f(hi)}`;
}

/** About how long the build takes, in minutes: AI shots take longest, three are made at a time. */
export function buildMinutes(beats: Pick<ScriptBeat, "source">[]): number {
  const ai = beats.filter((b) => b.source === "ai").length;
  const still = beats.filter((b) => b.source === "still").length;
  return Math.round(3 + (ai * 2.5) / 3 + (still * 1) / 3 + beats.length * 0.1);
}

// ---------- planning ----------

const PLAN_SHAPE = `{"title":"...","look":"...","music":"...","shots":[{"visual":"...","search":"...","key":false}]}`;

export function scriptPlanInstructions(opts: { count: number; first: boolean; look?: string; brand?: string; star?: string }): string {
  return `You are a film director turning a narrated script into shots. You get ${opts.count} numbered lines of the script, in order. Plan exactly one shot for each line, in the same order.
Rules:
- Never change, add or remove words of the script: you only plan what we see.
- "visual": what we see while that line is said, 15 to 40 words: one clear subject and one simple action or camera move. Show the idea of the line literally where possible (a line about saving money shows a jar of coins filling up). Nothing written anywhere: no captions, signs, labels or lettering. No real people, celebrities, brands, teams or logos. Adults only.
- "search": 2 to 4 plain words to find a matching free stock video (for example "city traffic night" or "woman typing laptop").
- "key": true only for the moments that matter most and that stock video can't show well: the opening hook, a specific product or character, a surprising or emotional moment. About one line in four.${opts.star ? `\n- The star of the video is ${opts.star}. Show them in the shots where the line is about them or the speaker.` : ""}${opts.brand ? `\n- The brand kit: ${opts.brand}. Use its colours in settings and light where it fits.` : ""}
${opts.first ? `- "title": a short name for the video. "look": one line listing what stays the same in every shot (each person's age, hair and outfit, the setting, the colour palette, the light). "music": genre, mood and tempo for a quiet instrumental bed, no vocals.` : `- The look of the video, to keep: ${opts.look ?? "natural, modern, warm light"}. Leave "title", "look" and "music" empty.`}
Reply with JSON only, in this shape: ${PLAN_SHAPE}`;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Reads the planner's reply for one batch of lines. Missing shots are filled in by rule. */
export function parseScriptBatch(raw: string, lines: string[]): { title: string; look: string; music: string; beats: Omit<ScriptBeat, "source">[] } {
  let j: Record<string, unknown> = {};
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      j = JSON.parse(raw.slice(start, end + 1));
    } catch {
      j = {};
    }
  }
  const shots = Array.isArray(j.shots) ? j.shots : [];
  return {
    title: clip(j.title, 80),
    look: clip(j.look, 400),
    music: clip(j.music, 200),
    beats: lines.map((text, i) => {
      const o = (shots[i] ?? {}) as Record<string, unknown>;
      const visual = clip(o.visual, 400);
      return {
        text,
        visual: visual.length > 8 ? visual : ruleVisual(text),
        search: clip(o.search, 60) || ruleSearch(text),
        key: o.key === true || undefined,
      };
    }),
  };
}

const STOP = new Set("a an the and or but so to of in on at for with from by is are was were be been it its this that these those you your we our they their i my me he she his her them as if then than not no yes do does did just very really can will would should could have has had what when where who how why there here about into over more most some any all".split(" "));

/** A stock search from the line's own words (the plainest nouns), used when the planner can't be reached. */
export function ruleSearch(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return words.slice(0, 3).join(" ") || "nature landscape";
}

export function ruleVisual(text: string): string {
  return `A cinematic shot that shows the idea of this line: ${text.replace(/["“”]/g, "").slice(0, 200)}`;
}

/** A plan by rule, for demo mode or when the planner can't be reached. */
export function scriptPlanWithRules(lines: string[]): ScriptPlan {
  return {
    title: lines[0]?.split(" ").slice(0, 6).join(" ").replace(/[.,!?;:]+$/, "") || "Your video",
    look: "natural modern look, warm soft light, calm colour palette",
    music: "calm modern instrumental, soft piano and light percussion, medium tempo",
    beats: lines.map((text, i) => ({ text, visual: ruleVisual(text), search: ruleSearch(text), key: i === 0 || undefined, source: "still" })),
  };
}

/** The prompt for an AI shot or still: the planned shot plus what stays the same in every shot. */
export function shotPrompt(plan: Pick<ScriptPlan, "look">, beat: Pick<ScriptBeat, "visual">, still = false): string {
  return `${beat.visual.replace(/[.\s]+$/, "")}. ${plan.look ? `Keep consistent: ${plan.look}.` : ""} ${still ? "A beautiful, detailed photograph, full frame." : ""} Nobody on screen talks. No captions, subtitles, logos, signs or written words anywhere. Full frame, edge to edge, no black bars.`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

/** The slow move on a still, alternating so the video doesn't feel the same shot after shot. */
export function stillMove(i: number): string {
  const moves = ["very slow push-in", "very slow pan left to right", "very slow pull-back", "very slow pan right to left"];
  return `A still photograph with a ${moves[i % moves.length]}, like a documentary. Nothing in the picture moves or changes, no new objects, no warping.`;
}

// ---------- timing and captions ----------

/** When each line starts, from how long each line lasts. */
export function startsFrom(lengths: number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const l of lengths) {
    out.push(at);
    at += l;
  }
  return out;
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Lines up the person's own recording with the lines of the script, from the
 * word timings the transcription gives back. Words the recording says a little
 * differently are skipped over; if too little matches, the time is shared by word count.
 */
export function alignRecording(lines: string[], words: { text: string; start: number }[], total: number): number[] {
  const counts = lines.map(countWords);
  const byCount = () => {
    const all = counts.reduce((a, b) => a + b, 0) || 1;
    return counts.map((c) => (c / all) * total);
  };
  const heard = words.map((w) => ({ w: norm(w.text), start: w.start })).filter((w) => w.w);
  if (heard.length < counts.reduce((a, b) => a + b, 0) * 0.5) return byCount();
  const starts: number[] = [];
  let k = 0;
  let matched = 0;
  for (let i = 0; i < lines.length; i++) {
    const first = norm(lines[i].split(/\s+/)[0] ?? "");
    // Look a little ahead for the line's first word.
    let found = -1;
    for (let j = k; j < Math.min(heard.length, k + 12); j++) if (heard[j].w === first) {
      found = j;
      break;
    }
    if (found >= 0) {
      matched++;
      starts.push(i === 0 ? 0 : heard[found].start);
      k = found + Math.max(1, counts[i] - 1);
    } else {
      starts.push(i === 0 ? 0 : heard[Math.min(heard.length - 1, k)]?.start ?? total);
      k += counts[i];
    }
  }
  if (matched < lines.length * 0.5) return byCount();
  // Keep the starts in order and every line at least half a second long.
  for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i], starts[i - 1] + 0.5);
  return starts.map((s, i) => Math.max(0.5, (i + 1 < starts.length ? starts[i + 1] : Math.max(total, s + 0.5)) - s));
}

/** Reads word timings out of the transcription result, whatever its exact shape. */
export function wordTimings(chunks: unknown): { text: string; start: number }[] {
  if (!Array.isArray(chunks)) return [];
  return chunks
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const ts = Array.isArray(o.timestamp) ? o.timestamp : [o.start, o.end];
      return { text: String(o.text ?? o.word ?? "").trim(), start: Number(ts[0]) };
    })
    .filter((w) => w.text && Number.isFinite(w.start));
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
};

/** A captions file (.srt) with the person's exact words, for YouTube, TikTok and the rest. Free. */
export function captionsFile(lines: string[], lengths: number[]): string {
  const starts = startsFrom(lengths);
  return lines.map((text, i) => `${i + 1}\n${srtTime(starts[i])} --> ${srtTime(starts[i] + lengths[i] - 0.05)}\n${text}\n`).join("\n");
}

// ---------- the job the browser builds ----------

export type BeatPart = {
  status: "waiting" | "working" | "done" | "failed";
  frame?: string; // an AI shot's first frame, or the still
  frameFor?: string; // what the frame was made from
  url?: string; // the finished shot
  madeFor?: string; // what the shot was made from, so a changed line is remade
  error?: string;
};

export type ScriptJob = {
  plan: ScriptPlan;
  aspectRatio: AspectRatio;
  voice: VoiceChoice;
  language: string;
  captions: boolean;
  music: boolean;
  clips: MyClip[];
  refs?: { url: string; kind: string; token: string }[];
  parts: BeatPart[];
  voices: (string | undefined)[]; // one per line (our voices or ElevenLabs)
  voiceFor: string[];
  lengths: (number | undefined)[]; // how long each line lasts, from its recording
  sections?: { url: string; for: string }[];
  voiceRuns?: Record<string, string>; // lines in a row joined into one track, by the lines' recordings
  musicUrl?: string;
  mixedUrl?: string;
  mixedFor?: string;
  captionedUrl?: string;
  step?: string;
};

export function newScriptJob(opts: Omit<ScriptJob, "parts" | "voices" | "voiceFor" | "lengths">): ScriptJob {
  return { ...opts, parts: opts.plan.beats.map(() => ({ status: "waiting" })), voices: [], voiceFor: [], lengths: [] };
}

/** What a line's shot is made from: a changed line, source, stock clip or own clip means a new shot. */
export function partKey(job: Pick<ScriptJob, "plan" | "clips">, i: number, seconds: number): string {
  const b = job.plan.beats[i];
  const len = Math.round(seconds * 10) / 10;
  if (b.source === "stock") return `stock|${b.stock?.url ?? ""}|${len}`;
  if (b.source === "mine") return `mine|${job.clips[b.clip ?? 0]?.url ?? ""}|${len}`;
  return `${b.source}|${b.visual}|${job.plan.look}|${b.source === "ai" ? (seconds > 5 ? 10 : 5) : len}`;
}

export function voiceName(v: VoiceChoice): string {
  if (v.kind === "recording") return "your own recording";
  if (v.kind === "eleven") return "your ElevenLabs voice";
  return AD_VOICES.find((x) => x.id === v.voice)?.label ?? AD_VOICES.find((x) => x.id === DEFAULT_VOICE)!.label;
}
