// Idea helpers, for people who don't know what to make yet.
// - "ideas": the user names their business and goal, and gets 5 ready-to-make
//   ad or post concepts.
// - "week": a week of posts (7 days) from the saved brand kit and the season.
// - "adapt": "Make one like this for my brand" turns an example or template
//   into one for the user's own product.
// About a tenth of a cent per AI call; simple rules when the AI can't be reached.

import { brandLine, type BrandInfo } from "./brand";

export type IdeaShape = "16:9" | "9:16" | "1:1";
export type Idea = {
  title: string;
  why: string;
  kind: "image" | "video";
  shape: IdeaShape;
  seconds: number; // 0 for pictures, 5 or 10 for clips
  prompt: string;
  day?: string; // only in a week plan, e.g. "Mon 25 Nov"
};

export const IDEA_LENGTHS = [5, 10];
const SHAPES = ["16:9", "9:16", "1:1"] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SAFE_RULES = `Rules: no real people, celebrities, other companies' brands, teams, jersey numbers or logos (describe people generically; the user's own brand name is fine). No words or captions inside the picture unless the idea really needs a short headline, then give it in quotes, spelled exactly, 5 words at most. Adults only. No nudity, gore or violence. Never promise prices, discounts or claims the user didn't give.`;

const PROMPT_RULE = (video: string) =>
  `"prompt": the full prompt for the AI generator, 50 to 100 words: the subject, the setting, the shot type and lens, where the light comes from, the colour palette and the mood. A picture is one frame from one camera position, never a sequence. ${video}`;

const VIDEO_RULE = `A video is ONE continuous clip of 5 or 10 seconds with one clear camera move and one main action, ending on a clear final frame.`;

/** The season and date, worked out in the browser (it knows the user's time zone). */
export function seasonFor(date: Date, timeZone?: string): string {
  const south = /^(Australia|Antarctica|Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Noumea))|America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima)|Africa\/(Johannesburg|Maputo|Harare|Windhoek|Gaborone|Maseru|Mbabane|Lusaka)|Indian\/(Mauritius|Reunion)/.test(
    timeZone ?? "",
  );
  const m = date.getMonth();
  const north = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][m];
  const flip: Record<string, string> = { winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" };
  const season = south ? flip[north] : north;
  return `${season} in the ${south ? "southern" : "northern"} hemisphere, ${date.getDate()} ${MONTHS[m]} ${date.getFullYear()}`;
}

/** The next seven days, starting tomorrow, as short labels like "Mon 25 Nov". */
export function weekDays(from: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i + 1);
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  });
}

export function ideasInstructions(brand?: BrandInfo): string {
  const b = brandLine(brand);
  return `You are a creative strategist for small businesses and creators. The user tells you their business and what they want to achieve. Give exactly 5 different concepts for social posts or short ads that they can make with an AI image or video generator right now. Mix pictures and short videos (at least 2 of each), and mix formats: for example a product hero, a behind-the-scenes moment, a problem-and-solution, a lifestyle scene, a seasonal or offer post.
Each concept has:
- "title": 2 to 5 plain words.
- "why": one sentence on why it works and where to post it.
- "kind": "image" or "video".
- "shape": "9:16" for TikTok, Reels and Shorts, "1:1" for the Instagram feed, "16:9" for YouTube and websites.
- "seconds": 0 for an image, 5 or 10 for a video.
- ${PROMPT_RULE(VIDEO_RULE)}
${SAFE_RULES}${b ? `\nThe user's brand kit: ${b}. Use its colours and style.` : ""}
Reply with JSON only: {"ideas":[{"title":"...","why":"...","kind":"video","shape":"9:16","seconds":5,"prompt":"..."}]}`;
}

export function weekInstructions(days: string[], season: string, brand?: BrandInfo): string {
  const b = brandLine(brand);
  return `You are a social media manager for a small business. Plan one post for each of the next 7 days: ${days.join(", ")}. Today is ${season}. Use the season and any holidays or shopping moments in these dates, but only ones that really fall in or just after this week. Vary the posts across the week (product, behind the scenes, tip, customer moment, seasonal, offer, weekend), with at least 2 videos and at least 2 pictures. Weekend posts can be lighter.
Each post has:
- "day": exactly one of ${days.map((d) => `"${d}"`).join(", ")}, in order, one each.
- "title": 2 to 5 plain words.
- "why": one sentence on why this post on this day.
- "kind": "image" or "video".
- "shape": "9:16" for TikTok, Reels and Shorts, "1:1" for the Instagram feed, "16:9" for YouTube and websites.
- "seconds": 0 for an image, 5 or 10 for a video.
- ${PROMPT_RULE(VIDEO_RULE)}
${SAFE_RULES}${b ? `\nThe brand kit: ${b}. Use its colours and style in every post.` : ""}
Reply with JSON only: {"ideas":[{"day":"${days[0]}","title":"...","why":"...","kind":"image","shape":"1:1","seconds":0,"prompt":"..."}]}`;
}

export function adaptInstructions(kind: "image" | "video", fields?: { key: string; label: string }[], brand?: BrandInfo): string {
  const b = brandLine(brand);
  const what = kind === "video" ? "short video" : "picture";
  const out = fields?.length
    ? `The example is a template with blanks. Fill every blank for the user's business so the result shows their product in the same style. Blanks: ${fields
        .map((f) => `"${f.key}" (${f.label})`)
        .join(", ")}. Each value is a short phrase, 2 to 12 words, that reads naturally in the template sentence.
Reply with JSON only: {"fields":{${fields.map((f) => `"${f.key}":"..."`).join(",")}}}`
    : `Rewrite the example prompt so it shows the user's own product or business instead, keeping the same style, shot, light, mood and shape, so the result looks like the example but is clearly theirs. 50 to 100 words.${kind === "image" ? " A picture is one frame from one camera position, never a sequence." : " Keep it one continuous clip with one camera move."}
Reply with JSON only: {"prompt":"..."}`;
  return `You help people make a ${what} like an example they liked, but for their own brand.
${out}
${SAFE_RULES}${b ? `\nThe user's brand kit: ${b}. Use its colours and style.` : ""}`;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function json(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1));
    return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function cleanIdea(o: unknown, days?: string[]): Idea | null {
  const x = (o ?? {}) as Record<string, unknown>;
  const kind = x.kind === "video" ? "video" : "image";
  const secs = Number(x.seconds);
  const prompt = clip(x.prompt, 1500);
  if (prompt.length < 30) return null;
  const day = days ? clip(x.day, 20) : "";
  return {
    title: clip(x.title, 50) || "Idea",
    why: clip(x.why, 220),
    kind,
    shape: (SHAPES as readonly string[]).includes(String(x.shape)) ? (String(x.shape) as IdeaShape) : kind === "video" ? "9:16" : "1:1",
    seconds: kind === "video" ? (secs > 7 ? 10 : 5) : 0,
    prompt,
    ...(days ? { day: days.includes(day) ? day : "" } : {}),
  };
}

/** Reads the AI's list of ideas. For a week plan, puts one idea on each day, in order. */
export function parseIdeas(raw: string, days?: string[]): Idea[] | null {
  const j = json(raw);
  if (!j || !Array.isArray(j.ideas)) return null;
  const ideas = j.ideas.map((o) => cleanIdea(o, days)).filter((i): i is Idea => i !== null);
  if (days) {
    if (ideas.length < days.length) return null;
    const left = [...ideas];
    return days.map((d) => {
      const at = left.findIndex((i) => i.day === d);
      const pick = at >= 0 ? left.splice(at, 1)[0] : left.shift()!;
      return { ...pick, day: d };
    });
  }
  return ideas.length >= 3 ? ideas.slice(0, 5) : null;
}

export function parseAdapt(raw: string, fields?: { key: string }[]): { prompt?: string; fields?: Record<string, string> } | null {
  const j = json(raw);
  if (!j) return null;
  if (fields?.length) {
    const f = (j.fields ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const { key } of fields) {
      const v = clip(f[key], 120);
      if (v) out[key] = v;
    }
    return Object.keys(out).length ? { fields: out } : null;
  }
  const prompt = clip(j.prompt, 1500);
  return prompt.length >= 30 ? { prompt } : null;
}

// ---------- simple rules when the AI can't be reached ----------

const strip = (s: string) => s.trim().replace(/[.!?\s]+$/, "");

function tailFor(brand?: BrandInfo): string {
  const b = brandLine(brand);
  return b ? ` Colours and style: ${b.replace(/^Brand name: [^;]+; ?/, "") || "clean and modern"}.` : "";
}

function ruleIdeas(business: string, goal: string, brand?: BrandInfo): Idea[] {
  const biz = strip(business) || "a small local business";
  const g = strip(goal);
  const t = tailFor(brand);
  return [
    {
      title: "Product hero shot",
      why: "A clean, premium picture that works on every feed and online store.",
      kind: "image",
      shape: "1:1",
      seconds: 0,
      prompt: `Premium commercial photo of the best-selling product from ${biz}, centred on a simple pedestal, 85mm close-up at eye level, soft key light from the left with a gentle rim light, clean seamless background, sharp focus, rich natural colours.${t}`,
    },
    {
      title: "Behind the scenes",
      why: `Shows the people and care behind ${biz}, which builds trust on Reels and TikTok.`,
      kind: "video",
      shape: "9:16",
      seconds: 5,
      prompt: `Vertical handheld clip inside ${biz}: hands carefully preparing the product on a workbench, 35mm medium close-up, slow push-in, warm daylight from a side window, natural colours, ending on the finished product facing the camera.${t}`,
    },
    {
      title: "Lifestyle moment",
      why: "Helps people picture themselves using it, great for the Instagram feed.",
      kind: "image",
      shape: "1:1",
      seconds: 0,
      prompt: `Natural lifestyle photo of a happy adult customer enjoying a product from ${biz} in a bright everyday setting, 35mm, shallow depth of field, golden hour light from behind, warm candid feel.${t}`,
    },
    {
      title: g ? "Goal teaser" : "Product reveal",
      why: g ? `A short, eye-catching clip built around your goal: ${g.slice(0, 80)}.` : "A quick reveal that stops the scroll on TikTok and Shorts.",
      kind: "video",
      shape: "9:16",
      seconds: 5,
      prompt: `Cinematic vertical product reveal for ${biz}${g ? `, made to ${g.slice(0, 120)}` : ""}: the product slowly turns on a dark glossy surface as a soft spotlight sweeps across it, 50mm, slow orbit, deep contrast, ending on a steady close-up of the product.${t}`,
    },
    {
      title: "Website banner",
      why: "A wide picture for your website, YouTube channel or email header.",
      kind: "image",
      shape: "16:9",
      seconds: 0,
      prompt: `Wide banner photo for ${biz}: the products neatly arranged on the right side of a calm, tidy setting with plenty of empty space on the left, 24mm wide shot, soft even daylight, clean modern look.${t}`,
    },
  ];
}

function ruleWeek(days: string[], business: string, brand?: BrandInfo): Idea[] {
  const base = ruleIdeas(business, "", brand);
  const extra: Idea[] = [
    {
      title: "Quick tip",
      why: "A useful tip makes people save and share the post.",
      kind: "video",
      shape: "9:16",
      seconds: 5,
      prompt: `Vertical top-down clip of hands showing one simple way to use a product from ${strip(business) || "the shop"} on a clean table, 35mm, steady overhead camera, bright soft daylight, ending on the result.${tailFor(brand)}`,
    },
    {
      title: "Weekend mood",
      why: "A relaxed, feel-good post that suits the weekend.",
      kind: "image",
      shape: "9:16",
      seconds: 0,
      prompt: `Relaxed weekend scene with a product from ${strip(business) || "the shop"} on a sunny outdoor table, 35mm, golden afternoon light from the side, soft shadows, warm happy colours.${tailFor(brand)}`,
    },
  ];
  const all = [base[0], base[1], base[2], extra[0], base[3], extra[1], base[4]];
  return days.map((day, i) => ({ ...all[i], day }));
}

export function ideasWithRules(business: string, goal: string, brand?: BrandInfo): Idea[] {
  return ruleIdeas(business, goal, brand);
}

export function weekWithRules(days: string[], business: string, brand?: BrandInfo): Idea[] {
  return ruleWeek(days, business || brand?.name || "", brand);
}

/** Without the AI: swap the example's product words for the user's, as best we can. */
export function adaptWithRules(
  example: string,
  business: string,
  fields?: { key: string; placeholder: string }[],
  brand?: BrandInfo,
): { prompt?: string; fields?: Record<string, string> } {
  const biz = strip(business) || brand?.name || "my product";
  // "a small bakery in Melbourne" is a business, not a product: show what it sells.
  const isBusiness = /\b(shop|store|bakery|caf[eé]|restaurant|studio|salon|business|company|brand|agency|gym|clinic|boutique|bar)\b/i.test(biz);
  const product = isBusiness ? `the signature product from ${biz.replace(/^(a|an|the|my|our)\s+/i, "a ")}` : biz;
  if (fields?.length) {
    const out: Record<string, string> = {};
    for (const f of fields) out[f.key] = f.key === "product" ? product : f.key === "brand" || f.key === "name" ? brand?.name || biz : f.placeholder;
    return { fields: out };
  }
  return { prompt: `${strip(example)}. Show ${product} as the main subject instead of the original product, in exactly the same style, light and framing.${tailFor(brand)}` };
}

/** What we tell the AI about the business. A bare brand name says nothing about what
 * they sell, so the AI must not invent a product (it once turned "ToastyFly" into a heater). */
export function aboutBusiness(business: string, name?: string): string {
  const known = business && business.toLowerCase() !== (name ?? "").trim().toLowerCase();
  if (known) return `The business:\n${business}`;
  return `The brand: ${name || business}\nThey haven't said what they sell. Do not invent a product or say what the business sells; build every post on the brand name and the brand style above.`;
}
