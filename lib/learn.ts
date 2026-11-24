// Learn from every fix.
//
// Every time someone fixes, remakes or flags a result, we note WHAT KIND of
// problem it was (for example "words on screen misspelled"), never who they are.
// When the same kind of problem keeps coming up for many different people, a
// general rule we wrote ahead of time for that problem is suggested. It goes
// live only after the owner turns it on, and it can be switched off any time.
// Live rules are added to the prompt booster's instructions for every new
// prompt of that kind (picture or video).
//
// Safety by design:
// - Users' own words are never put into anyone else's prompt. The prompt booster
//   only ever sees the rule text below (written by us) or a rule the owner typed.
// - One person can't change results for everyone: a rule needs reports from
//   several different people before it is even suggested, and an owner's OK.
// - Each live rule is measured: how often its problem needed fixing before it
//   went on, and since, on results that actually used it.
//
// This file is plain logic with no storage, so it can be tested. Storage is in
// lib/learnStore.ts. Until accounts exist the reports are kept in Netlify Blobs;
// the record shape below is ready to move into the accounts database as a table.

export type LessonKind = "image" | "video";
export type FeedbackKind = LessonKind | "ad" | "talk";

/** Where a report came from. */
export type FeedbackSource =
  | "fix" // the person asked for a change in the chat and accepted it
  | "find" // they accepted a fix after "Find what's wrong"
  | "check" // "Find what's wrong" found problems (they may not have fixed them)
  | "auto_check" // our automatic check after a video found problems
  | "recreate" // they pressed Re-create
  | "thumbs_down"
  | "thumbs_up"
  | "made"; // a result finished (used to work out "per 100 results")

export const SOURCES: FeedbackSource[] = ["fix", "find", "check", "auto_check", "recreate", "thumbs_down", "thumbs_up", "made"];

export type ProblemCode =
  | "garbled_text"
  | "extra_text"
  | "hands_bodies"
  | "face_changed"
  | "product_changed"
  | "wrong_colour"
  | "lighting"
  | "missing_item"
  | "wrong_count"
  | "too_busy"
  | "framing"
  | "facing_layout"
  | "motion_physics"
  | "vanishing"
  | "unwanted_speech"
  | "looks_fake"
  | "blurry"
  | "real_brand";

type Problem = {
  code: ProblemCode;
  label: string; // plain words for the owner's page
  match: RegExp;
  /** The general rule added to the prompt booster's instructions, per kind. Written by us, never by users. */
  rules: Partial<Record<LessonKind, string>>;
  /** Short words added to a video's "avoid" list when the rule is on. */
  avoid?: string;
  /** A few words added to the simple fallback booster (when the AI writer isn't available). */
  hint?: Partial<Record<LessonKind, string>>;
};

export const PROBLEMS: Problem[] = [
  {
    code: "garbled_text",
    label: "Words on screen misspelled or garbled",
    match: /\b(misspel\w*|spell(ing|ed)? (wrong|is wrong|mistake)|typos?|garbled|gibberish|scrambled|nonsense (letters|words|text)|unreadable|illegible|letters? (are |is )?(wrong|weird|messed|jumbled|broken)|(text|words?|writing|lettering|headline|title) (is |are |looks? )?(wrong|weird|messed( up)?|broken|jumbled|off|wonky))\b/i,
    rules: {
      image:
        "Words on the picture: keep them to one short line (ideally one to five words), copy them exactly as the user wrote them inside quotes, and ask for large, bold, simple lettering on a plain area. Never add any other words.",
      video:
        "Words in a video: only show words the user asked for, keep them to one to three short words on a flat surface facing the camera, and keep that surface still. If there is a lot of text, suggest adding it afterwards rather than inside the moving shot.",
    },
    hint: { image: "any words in one short line of bold, simple lettering, spelled exactly", video: "no extra writing, any words large and still" },
  },
  {
    code: "extra_text",
    label: "Words or signs nobody asked for",
    match: /\b((remove|get rid of|take out|delete|no|unwanted|extra|random|stray) (the )?(text|words?|writing|letters|captions?|signs?|watermarks?|labels?)|(text|words?|writing|watermark) (that )?(i|we) didn'?t ask for)\b/i,
    rules: {
      image: "If the user did not ask for any words, say \"no text, no letters, no signs with writing, no watermark\".",
      video: "If the user did not ask for any words, say \"no on-screen text, no captions, no signs with writing\".",
    },
    avoid: "text, captions, writing, watermark",
    hint: { image: "no text or writing", video: "no on-screen text" },
  },
  {
    code: "hands_bodies",
    label: "Hands, fingers or bodies look wrong",
    match: /\b(hands?|fingers?|thumbs?|arms?|legs?|limbs?|feet|anatomy|six fingers|extra (arm|finger|leg|hand)s?|(body|bodies) (looks?|is|are) (wrong|weird|off|twisted|broken))\b/i,
    rules: {
      image: "Hands: show them in simple, natural poses (a relaxed grip on one object, resting, or out of frame) and keep bodies in natural proportions with the right number of fingers and limbs.",
      video: "Hands and bodies: keep movements simple and natural, hands holding one thing with a relaxed grip, the right number of fingers and limbs, and bodies keeping their shape the whole time.",
    },
    avoid: "extra fingers, extra limbs, twisted hands",
    hint: { image: "natural relaxed hands", video: "natural hands and bodies" },
  },
  {
    code: "face_changed",
    label: "A person's face or look changes",
    match: /\b(face (changes?|changed|morph\w*|looks? different|is different)|(looks?|is) a different person|not the same (person|guy|woman|man|girl)|(hair|outfit|clothes) (changes?|changed))\b/i,
    rules: {
      video: "People: describe each person's hair and outfit once and add \"same face, hair and outfit from start to end\" to the Keep consistent line. Avoid fast head turns and anything covering the face.",
      image: "People: give each person one clear, simple look (hair, outfit) and keep faces fully visible and in focus.",
    },
    avoid: "changing faces, changing clothes",
  },
  {
    code: "product_changed",
    label: "The product or logo looks wrong or changes",
    match: /\b((product|bottle|can|box|package|packaging|label|logo|shoe|sneaker|jar|cup|bag) (is |looks? |was )?(wrong|different|changed|changes|warped|distorted|melting|morph\w*|not (the same|right|mine))|wrong (product|label|logo|bottle))\b/i,
    rules: {
      image: "Products: show the product large, sharp, upright and fully in frame, not cut off or covered by hands, with its label facing the camera.",
      video: "Products: keep the product large, steady and fully in frame, label facing the camera, with slow, simple movement around it, and add \"same product shape, colour and label throughout\" to the Keep consistent line.",
    },
    avoid: "product changing shape, label changing",
  },
  {
    code: "wrong_colour",
    label: "Colours not what was asked",
    match: /\b(wrong colou?rs?|colou?rs? (are |is |look )?(wrong|off|different)|should be (red|blue|green|yellow|black|white|pink|purple|orange|gold|silver|brown|grey|gray)|not (red|blue|green|yellow|black|white|pink|purple|orange) enough)\b/i,
    rules: {
      image: "Colours: name the colour of each important thing plainly (for example \"a red mug\") and keep the lighting neutral enough that those colours stay true.",
      video: "Colours: name the colour of each important thing plainly and add those colours to the Keep consistent line so they don't drift.",
    },
  },
  {
    code: "lighting",
    label: "Too dark, too bright or odd lighting",
    match: /\b(too (dark|bright|dim|washed out)|lighting|overexposed|underexposed|(shadows?|light) (is |are )?(wrong|weird|off|inconsistent))\b/i,
    rules: {
      image: "Lighting: name one clear main light, where it comes from and how bright it is, and keep the subject well lit and easy to see.",
      video: "Lighting: name one clear main light and where it comes from, keep it steady through the clip, and keep the subject well lit.",
    },
    hint: { image: "bright, even light on the subject", video: "steady, even light" },
  },
  {
    code: "missing_item",
    label: "Something the person asked for is missing",
    match: /\b(missing|forgot(ten)?|left out|(where|where's|where is) the|there('s| is| was) no|not (there|in it|included|showing)|didn'?t (include|show|add)|i asked for (a|an|the))\b/i,
    rules: {
      image: "Before writing, list every person, animal and object the user named, and place each one clearly in the frame. Nothing they named may be left out or hidden.",
      video: "Before writing, list every person, animal and object the user named, and make sure each one is in frame from the first beat and stays there to the end.",
    },
  },
  {
    code: "wrong_count",
    label: "Wrong number of people or things",
    match: /\b((too many|too few|extra|duplicate\w*|cloned?|twins?) (people|persons?|men|women|kids|dogs?|cats?|cars?|objects?|bottles?|players?)|only (one|two|three) (person|people|dog|cat|car)|(two|three|four) of (him|her|them|it)|should be (one|two|three|four|five))\b/i,
    rules: {
      image: "Numbers: say exactly how many people, animals and main objects there are (for example \"exactly two people\") and nobody else in the frame.",
      video: "Numbers: say exactly how many people, animals and main objects there are and add \"same number of people\" to the Keep consistent line; nobody new walks in.",
    },
    avoid: "extra people, duplicate people",
  },
  {
    code: "too_busy",
    label: "Too busy or cluttered",
    match: /\b(too (busy|much going on|cluttered|crowded|messy|many things)|cluttered|busy background|simpler|less (stuff|clutter)|minimal)\b/i,
    rules: {
      image: "Keep the scene simple: one clear main subject, only a few supporting objects, and a clean, uncluttered background.",
      video: "Keep each clip simple: one main subject and one main action, with a clean background and nothing extra happening.",
    },
    hint: { image: "simple, clean background", video: "one main subject, clean background" },
  },
  {
    code: "framing",
    label: "Cut off, too close or too far",
    match: /\b(cut off|cropped|out of (the )?frame|too (close|far|zoomed( in| out)?|small|big)|zoom (in|out)|closer|further away|can'?t see (the|her|his|their) (head|feet|face)|head is cut)\b/i,
    rules: {
      image: "Framing: keep the main subject fully in frame with a little space around it, and state the shot size (close-up, medium or wide).",
      video: "Framing: keep the main subject fully in frame from start to end with space around it, and state the shot size; the camera move must not push it out of frame.",
    },
    hint: { image: "subject fully in frame", video: "subject stays fully in frame" },
  },
  {
    code: "facing_layout",
    label: "Wrong angle, direction or layout",
    match: /\b(wrong (angle|side|way|direction|camera)|angle (is )?wrong|facing (the )?(wrong|away|backwards?)|backwards|upside down|mirror(ed)?|(left|right) side|from (above|below|behind|the front|the side)|perspective|layout)\b/i,
    rules: {
      image: "Layout: state where the camera is and which way each person and object faces, and keep left and right consistent with that camera position.",
      video: "Layout: state where the camera is and which way each person and object faces at the start, and keep those directions through the clip unless the user asked for a turn.",
    },
  },
  {
    code: "motion_physics",
    label: "Unreal motion: floating, passing through things, morphing",
    match: /\b(through (the )?(walls?|doors?|tables?|cars?|each other|people|floor)|float(s|ing)?|morph\w*|melt\w*|warp\w*|physics|glitch\w*|jitter\w*|moves? (weird|strange|unnatural)|unnatural (motion|movement)|teleport\w*|slides? (across|along))\b/i,
    rules: {
      video: "Motion: one slow, simple movement per person or object, each on its own path, feet on the ground and objects resting or held; nothing passes through anything else or changes shape.",
      image: "Physics: everything rests on a surface or is held; nothing floats or overlaps in a way that couldn't happen.",
    },
    avoid: "floating, morphing, passing through objects",
    hint: { video: "slow, simple, realistic motion" },
  },
  {
    code: "vanishing",
    label: "Something vanishes or turns to smoke",
    match: /\b(disappear\w*|vanish\w*|turns? into (smoke|dust|mist)|fades? (away|out)|goes? missing|left the (frame|shot))\b/i,
    rules: {
      video: "Every main person and object stays in the frame and solid until the last frame; nothing turns into smoke or dust, fades or leaves unless the user asked.",
    },
    avoid: "disappearing, fading away, smoke, dust",
  },
  {
    code: "unwanted_speech",
    label: "Someone talks when nobody asked for speech",
    match: /\b((someone|somebody|a voice|people|he|she|they) (is |are )?(talking|speaking|says|said)|unwanted (voice|speech|talking)|(don'?t|didn'?t) (want|ask for) (talking|speech|a voice|voices|dialogue)|no (talking|speech|voice|dialogue|narration)|remove the (voice|talking|speech))\b/i,
    rules: {
      video: "Sound: unless the user asked for speech, say \"no dialogue, no voice, no narration\" and describe only ambience, sound effects and music.",
    },
    avoid: "speech, dialogue, talking",
  },
  {
    code: "looks_fake",
    label: "Looks fake, plastic or too AI",
    match: /\b(looks? (fake|plastic|cgi|artificial|ai|cartoon(ish|y)?|like a (render|cartoon|video game))|too (fake|plastic|cgi|smooth|glossy|perfect|cartoon(ish|y)?|airbrushed)|not realistic|unrealistic|more real(istic)?|uncanny)\b/i,
    rules: {
      image: "For photos, ask for a real photo look: natural skin texture, real materials, true-to-life colours and soft, real light; avoid a glossy, plastic or CGI look.",
      video: "For realistic videos, ask for a real camera look: natural skin and materials, true-to-life colours, gentle real light and natural speed; avoid a glossy, plastic or CGI look.",
    },
    hint: { image: "natural, true-to-life photo look", video: "natural, true-to-life look" },
  },
  {
    code: "blurry",
    label: "Blurry or low quality",
    match: /\b(blurr?y|blurred|fuzzy|out of focus|not sharp|pixel(ated|y)|grainy|low (quality|res(olution)?)|soft focus)\b/i,
    rules: {
      image: "Ask for sharp focus on the main subject with fine, crisp detail.",
      video: "Ask for sharp focus on the main subject, steady camera and fine detail; avoid fast motion that causes blur.",
    },
    avoid: "blur, out of focus",
    hint: { image: "sharp focus", video: "sharp focus, steady camera" },
  },
  {
    code: "real_brand",
    label: "Real brand, team or logo appeared",
    match: /\b((real|actual|famous) (brand|team|logo|company)s?|trademark\w*|(brand|team) (name|logo)s? (appeared|showed up|i didn'?t ask))\b/i,
    rules: {
      image: "Keep clothes, products and signs plain or with made-up names; describe colours instead of any real brand, team or logo.",
      video: "Keep clothes, products and signs plain or with made-up names throughout; describe colours instead of any real brand, team or logo.",
    },
    avoid: "real brand logos, team logos",
  },
];

export const PROBLEM_CODES = PROBLEMS.map((p) => p.code);
const byCode = new Map(PROBLEMS.map((p) => [p.code, p]));

export function problemLabel(code: string): string {
  return byCode.get(code as ProblemCode)?.label ?? code;
}

/** The fault codes our checker gives, mapped to problems. */
const FAULT_TO_PROBLEM: Record<string, ProblemCode> = {
  garbled_text: "garbled_text",
  product_changed: "product_changed",
  missing_item: "missing_item",
  unwanted_speech: "unwanted_speech",
};

/** Reads what kind of problem a note describes. Free, instant, no AI. Up to 3, most specific first. */
export function classify(text: string, faults: string[] = []): ProblemCode[] {
  const out: ProblemCode[] = [];
  for (const f of faults) {
    const p = FAULT_TO_PROBLEM[f];
    if (p && !out.includes(p)) out.push(p);
  }
  const t = (text || "").slice(0, 2000);
  for (const p of PROBLEMS) {
    if (out.length >= 3) break;
    if (!out.includes(p.code) && p.match.test(t)) out.push(p.code);
  }
  // "no text" style complaints are about unwanted words, not spelling.
  if (out.includes("extra_text") && out.includes("garbled_text") && !/\b(misspel|spell|typo|garbled|gibberish|scrambled)/i.test(t))
    out.splice(out.indexOf("garbled_text"), 1);
  return out.slice(0, 3);
}

/** Lessons are grouped by picture or video. Ads are mostly video; talking videos are their own thing. */
export function lessonKind(kind: string): LessonKind | null {
  if (kind === "image") return "image";
  if (kind === "video" || kind === "ad") return "video";
  return null;
}

// ---------- What a stored report looks like ----------

/**
 * One report. Holds no name, email, account, picture, face or voice. `who` is a
 * scrambled form of a random number made by the browser (only used to count
 * different people). `result` is the random id of the result, so the same result
 * is never counted twice for the same problem. `note` is only kept for reports we
 * couldn't match to a known problem, cleaned of contact details, shortened, and
 * deleted after NOTE_DAYS. It is shown to the owner only, never put in a prompt.
 */
export type FeedbackEvent = {
  at: string; // ISO time
  source: FeedbackSource;
  kind: FeedbackKind;
  model: string;
  template?: string;
  problems: ProblemCode[];
  lessons?: string[]; // ids of the rules this result was made with
  who: string;
  result: string;
  note?: string;
};

/** How long reports are kept. */
export const KEEP_DAYS = 120;
/** How long the cleaned "other" comments are kept. */
export const NOTE_DAYS = 30;
/** The window used to spot a pattern. */
export const WINDOW_DAYS = 60;
/** A rule is suggested once its problem was reported on this many different results… */
export const MIN_REPORTS = 5;
/** …by at least this many different people. */
export const MIN_PEOPLE = 3;
/** Before/after numbers are only shown once both sides have this many results. */
export const MIN_RESULTS_TO_COMPARE = 20;
/** At most this many rules go into one prompt, most reported first. */
export const MAX_RULES_PER_PROMPT = 6;

/** Removes contact details and links from a comment, and shortens it. */
export function scrub(text: string, max = 160): string {
  return (text || "")
    .replace(/[\u0000-\u001f<>]/g, " ")
    .replace(/\S+@\S+\.\S+/g, "[email]")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link]")
    .replace(/@[\w.]{2,}/g, "[handle]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ---------- The owner's switches ----------

export type RuleState = { on: boolean; at: string; skipped?: boolean };
export type CustomRule = { id: string; kind: LessonKind; text: string; on: boolean; at: string; problem?: ProblemCode };
export type LearnSettings = { rules: Record<string, RuleState>; custom: CustomRule[] };
export const EMPTY_SETTINGS: LearnSettings = { rules: {}, custom: [] };

export const ruleId = (code: ProblemCode, kind: LessonKind) => `${code}:${kind}`;

export type ActiveLesson = { id: string; text: string; avoid?: string; hint?: string; problem?: ProblemCode };

/** Every rule in our catalogue, one per problem and kind. */
export function catalogue(): (ActiveLesson & { kind: LessonKind; problem: ProblemCode })[] {
  const out: (ActiveLesson & { kind: LessonKind; problem: ProblemCode })[] = [];
  for (const p of PROBLEMS)
    for (const kind of ["image", "video"] as LessonKind[]) {
      const text = p.rules[kind];
      if (text) out.push({ id: ruleId(p.code, kind), kind, problem: p.code, text, avoid: kind === "video" ? p.avoid : undefined, hint: p.hint?.[kind] });
    }
  return out;
}

/** The rules switched on for this kind, to add to the prompt booster. */
export function activeLessons(settings: LearnSettings, kind: LessonKind): ActiveLesson[] {
  const on = catalogue().filter((r) => r.kind === kind && settings.rules[r.id]?.on);
  const custom = settings.custom.filter((c) => c.on && c.kind === kind).map((c) => ({ id: c.id, text: c.text, problem: c.problem }));
  // Most recently approved last, so the newest never pushes out an older, proven rule.
  const all = [...on.sort((a, b) => (settings.rules[a.id]!.at < settings.rules[b.id]!.at ? -1 : 1)), ...custom];
  return all.slice(0, MAX_RULES_PER_PROMPT);
}

/** The block added to the prompt booster's instructions. Only our rule text, never a user's words. */
export function lessonsBlock(lessons: ActiveLesson[]): string {
  if (!lessons.length) return "";
  return `\nLessons learned from results people had to fix. Follow these general rules unless the user's description asks for something different:\n${lessons
    .map((l) => `- ${l.text}`)
    .join("\n")}`;
}

/** Adds the live rules' "avoid" words to a video's avoid list, without repeats. */
export function mergeAvoid(base: string | undefined, lessons: ActiveLesson[]): string | undefined {
  const extra = lessons.map((l) => l.avoid).filter(Boolean) as string[];
  if (!extra.length) return base;
  const parts = [...(base ? base.split(",") : []), ...extra.join(",").split(",")].map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts.map((s) => s.toLowerCase()))].join(", ").slice(0, 300);
}

// ---------- The owner's page: what keeps going wrong, and what to switch on ----------

export type ProblemStat = {
  problem: ProblemCode;
  kind: LessonKind;
  label: string;
  reports: number; // different results with this problem in the window
  people: number;
  topModels: { model: string; reports: number }[];
};

export type RuleView = {
  id: string;
  kind: LessonKind;
  problem?: ProblemCode;
  label: string;
  text: string;
  custom: boolean;
  status: "on" | "off" | "suggested" | "waiting"; // waiting = not enough reports yet
  reports: number;
  people: number;
  onSince?: string;
  /** Problem reports per 100 results, before the rule went on and since (only results made with it). */
  before?: { rate: number; results: number };
  after?: { rate: number; results: number };
  verdict?: string;
};

export type LearnSummary = {
  windowDays: number;
  totals: { reports: number; results: number; people: number; thumbsUp: number; thumbsDown: number; remakes: number };
  problems: ProblemStat[];
  rules: RuleView[];
  comments: { at: string; kind: FeedbackKind; source: FeedbackSource; note: string }[];
};

const DAY = 86_400_000;
const isReport = (e: FeedbackEvent) => e.source !== "made" && e.source !== "thumbs_up";

function rate(reports: number, results: number) {
  return results > 0 ? Math.round((reports / results) * 1000) / 10 : 0;
}

/** Builds the owner's page from the reports. `now` is passed in so it can be tested. */
export function summarize(events: FeedbackEvent[], settings: LearnSettings, now = Date.now()): LearnSummary {
  const since = now - WINDOW_DAYS * DAY;
  const recent = events.filter((e) => Date.parse(e.at) >= since);

  // Count each problem once per result (a check and the fix after it are one problem).
  const seen = new Set<string>();
  const stats = new Map<string, { reports: number; people: Set<string>; models: Map<string, number> }>();
  for (const e of recent) {
    if (!isReport(e)) continue;
    const k = lessonKind(e.kind);
    if (!k) continue;
    for (const p of e.problems) {
      const key = `${p}:${k}`;
      const once = `${key}|${e.result}`;
      if (seen.has(once)) continue;
      seen.add(once);
      const s = stats.get(key) ?? { reports: 0, people: new Set(), models: new Map() };
      s.reports++;
      s.people.add(e.who);
      s.models.set(e.model, (s.models.get(e.model) ?? 0) + 1);
      stats.set(key, s);
    }
  }

  const problems: ProblemStat[] = [...stats.entries()]
    .map(([key, s]) => {
      const [problem, kind] = key.split(":") as [ProblemCode, LessonKind];
      return {
        problem,
        kind,
        label: problemLabel(problem),
        reports: s.reports,
        people: s.people.size,
        topModels: [...s.models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([model, reports]) => ({ model, reports })),
      };
    })
    .sort((a, b) => b.reports - a.reports || b.people - a.people);

  const statOf = (id: string) => stats.get(id);
  const rules: RuleView[] = [];
  for (const r of catalogue()) {
    const s = statOf(r.id);
    const state = settings.rules[r.id];
    const reports = s?.reports ?? 0;
    const people = s?.people.size ?? 0;
    const enough = reports >= MIN_REPORTS && people >= MIN_PEOPLE;
    const status: RuleView["status"] = state?.on ? "on" : enough && !state?.skipped ? "suggested" : enough ? "off" : "waiting";
    const view: RuleView = { id: r.id, kind: r.kind, problem: r.problem, label: problemLabel(r.problem), text: r.text, custom: false, status, reports, people };
    if (state?.on) Object.assign(view, { onSince: state.at, ...measure(events, r.id, r.problem, r.kind, Date.parse(state.at)) });
    rules.push(view);
  }
  for (const c of settings.custom) {
    const s = c.problem ? statOf(ruleId(c.problem, c.kind)) : undefined;
    const view: RuleView = {
      id: c.id,
      kind: c.kind,
      problem: c.problem,
      label: c.problem ? problemLabel(c.problem) : "Your own rule",
      text: c.text,
      custom: true,
      status: c.on ? "on" : "off",
      reports: s?.reports ?? 0,
      people: s?.people.size ?? 0,
    };
    if (c.on) Object.assign(view, { onSince: c.at, ...(c.problem ? measure(events, c.id, c.problem, c.kind, Date.parse(c.at)) : {}) });
    rules.push(view);
  }
  const order = { suggested: 0, on: 1, off: 2, waiting: 3 };
  rules.sort((a, b) => order[a.status] - order[b.status] || b.reports - a.reports);

  const noteSince = now - NOTE_DAYS * DAY;
  const comments = recent
    .filter((e) => e.note && Date.parse(e.at) >= noteSince)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50)
    .map((e) => ({ at: e.at, kind: e.kind, source: e.source, note: e.note! }));

  return {
    windowDays: WINDOW_DAYS,
    totals: {
      reports: recent.filter(isReport).length,
      results: recent.filter((e) => e.source === "made").length,
      people: new Set(recent.map((e) => e.who)).size,
      thumbsUp: recent.filter((e) => e.source === "thumbs_up").length,
      thumbsDown: recent.filter((e) => e.source === "thumbs_down").length,
      remakes: recent.filter((e) => e.source === "recreate").length,
    },
    problems,
    rules,
    comments,
  };
}

/**
 * Did the rule help? Before: this problem per 100 results of that kind, in the
 * window before it went on. Since: per 100 results that were made WITH the rule.
 * Says "not enough yet" until both sides have enough results, so we never claim
 * an improvement we haven't measured.
 */
export function measure(events: FeedbackEvent[], id: string, problem: ProblemCode, kind: LessonKind, onAt: number): Pick<RuleView, "before" | "after" | "verdict"> {
  const ofKind = events.filter((e) => lessonKind(e.kind) === kind);
  const beforeFrom = onAt - WINDOW_DAYS * DAY;
  const pre = ofKind.filter((e) => {
    const t = Date.parse(e.at);
    return t >= beforeFrom && t < onAt;
  });
  const post = ofKind.filter((e) => Date.parse(e.at) >= onAt && e.lessons?.includes(id));
  const count = (list: FeedbackEvent[]) => {
    const results = list.filter((e) => e.source === "made").length;
    const hit = new Set(list.filter((e) => isReport(e) && e.problems.includes(problem)).map((e) => e.result)).size;
    return { rate: rate(hit, results), results };
  };
  const before = count(pre);
  const after = count(post);
  let verdict: string;
  if (before.results < MIN_RESULTS_TO_COMPARE || after.results < MIN_RESULTS_TO_COMPARE)
    verdict = `Not enough results yet to tell (${after.results} made with it so far; we need at least ${MIN_RESULTS_TO_COMPARE} on each side).`;
  else if (after.rate < before.rate * 0.8) verdict = "Looks like it's helping.";
  else if (after.rate > before.rate * 1.2) verdict = "This problem got more common since. Consider switching it off.";
  else verdict = "No clear change yet.";
  return { before, after, verdict };
}

// ---------- Checking what comes in ----------

const KINDS: FeedbackKind[] = ["image", "video", "ad", "talk"];
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");

/** Turns what the browser sent into a safe report, or null if it isn't one. */
export function toEvent(
  raw: { source?: unknown; kind?: unknown; model?: unknown; template?: unknown; note?: unknown; problems?: unknown; faults?: unknown; lessons?: unknown; result?: unknown },
  who: string,
  now = new Date(),
): FeedbackEvent | null {
  const source = raw.source as FeedbackSource;
  const kind = raw.kind as FeedbackKind;
  if (!SOURCES.includes(source) || !KINDS.includes(kind)) return null;
  const result = clip(raw.result, 64);
  if (!/^[\w-]{6,64}$/.test(result)) return null;
  const noteText = clip(raw.note, 1000);
  const problemText = Array.isArray(raw.problems) ? raw.problems.filter((p) => typeof p === "string").slice(0, 6).join(" ") : "";
  const faults = Array.isArray(raw.faults) ? raw.faults.filter((f): f is string => typeof f === "string").slice(0, 6) : [];
  const problems = source === "made" || source === "thumbs_up" ? [] : classify(`${noteText} ${problemText}`, faults);
  const lessons = Array.isArray(raw.lessons)
    ? raw.lessons.filter((l): l is string => typeof l === "string" && /^[\w:-]{3,60}$/.test(l)).slice(0, MAX_RULES_PER_PROMPT + 2)
    : undefined;
  // Only the person's own words, and only when we couldn't match them, are kept (cleaned) for the owner to read.
  const note = noteText && problems.length === 0 && source !== "made" ? scrub(noteText) : undefined;
  return {
    at: now.toISOString(),
    source,
    kind,
    model: clip(raw.model, 80) || "unknown",
    template: clip(raw.template, 80) || undefined,
    problems,
    lessons: lessons?.length ? lessons : undefined,
    who,
    result,
    note: note || undefined,
  };
}
