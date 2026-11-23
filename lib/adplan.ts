// Full ad mode: the user describes a product, who it's for, the length and the
// tone. We plan a concept and a scene-by-scene script they can review and edit
// before anything is paid for. Then every scene is made, a voiceover and music
// are added, and it all comes back as one finished video.

export type AdScene = {
  visual: string; // what we see
  camera: string; // shot type and one move
  text: string; // short on-screen words (shown in the plan; the end card carries the words in the video)
  voice: string; // the voiceover line for this scene
};

export type AdPlan = {
  title: string;
  concept: string;
  look: string; // the consistency lock: product, people, colours, setting, light
  music: string;
  voice: string; // voice name
  scenes: AdScene[];
  endCard: { headline: string; tagline: string; voice: string };
  seconds: number;
};

import { brandLine, type BrandInfo } from "./brand";

export type AdBrief = { product: string; audience: string; seconds: number; tone: string; refKinds?: string[]; brand?: BrandInfo };

export const AD_LENGTHS = [15, 30, 60] as const;
export const AD_TONES = ["Friendly", "Premium", "Energetic", "Funny", "Calm"] as const;
export const SCENE_SECONDS = 5;
export const AD_VOICES: { id: string; label: string }[] = [
  { id: "Rachel", label: "Warm female" },
  { id: "Sarah", label: "Soft female" },
  { id: "Aria", label: "Confident female" },
  { id: "Brian", label: "Deep male" },
  { id: "Charlie", label: "Upbeat male" },
  { id: "Roger", label: "Relaxed male" },
];

/** Scenes are 5 seconds each; the end card fills the rest (3 to 7 seconds). */
export function sceneCount(seconds: number): number {
  return Math.max(1, Math.floor((seconds - 3) / SCENE_SECONDS));
}
export function endCardSeconds(seconds: number): number {
  return seconds - sceneCount(seconds) * SCENE_SECONDS;
}
/** About 2.3 spoken words a second, leaving a breath between scenes. */
export function maxVoiceWords(seconds: number): number {
  return Math.max(4, Math.floor(seconds * 2.3) - 1);
}

const JSON_SHAPE = `{"title":"...","concept":"two sentences","look":"...","music":"...","voice":"Rachel","scenes":[{"visual":"...","camera":"...","text":"...","voice":"..."}],"endCard":{"headline":"...","tagline":"...","voice":"..."}}`;

export function adPlanInstructions(brief: AdBrief): string {
  const n = sceneCount(brief.seconds);
  const card = endCardSeconds(brief.seconds);
  const refs = brief.refKinds?.length
    ? `The user uploaded their own ${brief.refKinds.join(" and ")} picture(s). Every scene that shows the product must show it exactly as in their picture; describe it plainly as "the product" and never invent a different design, colour or label.`
    : "The user did not upload a product picture, so describe the product's look once, clearly, in the look line, and keep it identical in every scene.";
  const brand = brandLine(brief.brand);
  return `You are an award-winning ad creative director. Plan a ${brief.seconds}-second video ad.
Tone: ${brief.tone}. ${refs}${brand ? `\nThe brand kit: ${brand}. Use the brand colours in the look line (setting, props, light) and on the end card, follow the brand style, and use the brand name on the end card.` : ""}
Write exactly ${n} scenes of ${SCENE_SECONDS} seconds each, then an end card of ${card} seconds.
Rules:
- Open with a hook in scene 1 (a striking moment, a problem the audience feels, or a surprising visual). Show the product in use, the benefit, then the payoff. The end card has the product name and a short call to action.
- Each scene "visual": one clear action in ${SCENE_SECONDS} seconds, 20 to 45 words, describing what we see and what moves. No text, captions, signs or logos inside the scene (AI video garbles words). No real people, celebrities, brands, teams or logos. Adults only.
- "camera": shot type and one move, for example "close-up, slow push-in" or "wide shot, gentle pan right".
- "look": one line listing what must stay the same in every scene: the product's shape, colour and label, each person's age, hair and outfit, the colour palette, the setting and the light. This is repeated into every scene so they match.
- "text": up to 5 words of on-screen copy for that moment (shown in the plan; the words are rendered on the end card).
- "voice": the voiceover for that scene, at most ${maxVoiceWords(SCENE_SECONDS)} words, natural and spoken, matching the ${brief.tone.toLowerCase()} tone. Together the lines tell one short story.
- "music": genre, mood and tempo for an instrumental background bed, no vocals.
- "voice" (top level): pick one of ${AD_VOICES.map((v) => `${v.id} (${v.label})`).join(", ")}.
- "endCard": "headline" is the product name or a 2 to 4 word promise, "tagline" is a call to action up to 6 words, "voice" says it in at most ${maxVoiceWords(card)} words.
Reply with JSON only, in this shape: ${JSON_SHAPE}`;
}

export function revisePlanInstructions(brief: AdBrief): string {
  return `${adPlanInstructions(brief)}
You are now editing an existing plan. Apply the user's change request, keep everything else exactly the same, and keep the same number of scenes. Reply with the whole updated plan as JSON only.`;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const wordsMax = (s: string, n: number) => s.split(" ").slice(0, n).join(" ");

/** Reads the planner's JSON reply and fits it to the length; null if it is unusable. */
export function parseAdPlan(raw: string, brief: AdBrief): AdPlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const n = sceneCount(brief.seconds);
    const scenes = (Array.isArray(j.scenes) ? j.scenes : [])
      .map((s) => {
        const o = (s ?? {}) as Record<string, unknown>;
        return {
          visual: clip(o.visual, 500),
          camera: clip(o.camera, 120),
          text: wordsMax(clip(o.text, 60), 6),
          voice: wordsMax(clip(o.voice, 200), maxVoiceWords(SCENE_SECONDS)),
        };
      })
      .filter((s) => s.visual.length > 8)
      .slice(0, n);
    if (scenes.length < n) return null;
    const ec = (j.endCard ?? {}) as Record<string, unknown>;
    const voice = AD_VOICES.some((v) => v.id === j.voice) ? String(j.voice) : "Rachel";
    return {
      title: clip(j.title, 80) || "Your ad",
      concept: clip(j.concept, 400),
      look: clip(j.look, 400),
      music: clip(j.music, 200) || "warm modern instrumental, light percussion, medium tempo",
      voice,
      scenes,
      endCard: {
        headline: clip(ec.headline, 40) || "Try it today",
        tagline: clip(ec.tagline, 60),
        voice: wordsMax(clip(ec.voice, 160), maxVoiceWords(endCardSeconds(brief.seconds))),
      },
      seconds: brief.seconds,
    };
  } catch {
    return null;
  }
}

/** Plain fallback when the planner can't be reached. */
export function adPlanWithRules(brief: AdBrief): AdPlan {
  const n = sceneCount(brief.seconds);
  const product = brief.product.trim().split(/[.!?\n]/)[0].slice(0, 120) || "the product";
  const name = product.split(/[,:;–—(]| - /)[0].trim().split(" ").slice(0, 4).join(" ") || "It";
  const who = brief.audience.trim().slice(0, 100) || "people who will love it";
  const beats = [
    { visual: `A relatable everyday moment for ${who}, a small problem they know well, natural light`, camera: "medium shot, slow push-in", text: "Sound familiar?", voice: "We've all been there." },
    { visual: `${product} is revealed on a clean surface, light catching its shape`, camera: "close-up, slow orbit", text: "Meet the fix", voice: `Meet ${name}.` },
    { visual: `A person from the audience uses ${product} with ease and smiles`, camera: "medium close-up, gentle handheld", text: "Easy", voice: "It just works, every day." },
    { visual: `Detail shots of ${product} in action, showing what makes it different`, camera: "macro close-up, slow slide", text: "Made better", voice: "Made with care, built to last." },
    { visual: `The person enjoys the result, relaxed and happy, warm light`, camera: "wide shot, slow pull-back", text: "Feel the difference", voice: "Feel the difference." },
  ];
  const scenes = Array.from({ length: n }, (_, i) => beats[Math.min(i, beats.length - 1)]);
  return {
    title: `${name} ad`,
    concept: `A short ${brief.tone.toLowerCase()} ad that shows a problem ${who} know well, then ${product} as the simple answer.`,
    look: `${product} looks the same in every scene; same person, same outfit; warm natural colours; bright modern home setting`,
    music: brief.tone === "Energetic" ? "upbeat electronic pop instrumental, punchy drums, fast tempo" : brief.tone === "Premium" ? "minimal cinematic piano and strings, slow tempo" : "warm acoustic guitar and light percussion, medium tempo",
    voice: brief.tone === "Energetic" ? "Charlie" : "Rachel",
    scenes,
    endCard: { headline: name, tagline: "Try it today", voice: `${name}. Try it today.` },
    seconds: brief.seconds,
  };
}

// ---------- prices (always shown as a range) ----------

export const AD_PRICES = {
  scene: 0.35, // Kling 2.5 Turbo Pro, 5 seconds
  picture: 0.04, // Nano Banana: the product picture, each scene's first frame, the end card
  voicePer1000Chars: 0.05,
  musicPerMinute: 0.02,
  cardPerSecond: 0.02, // the end card's gentle move
  editPerSecond: 0.0006, // joining and mixing
  checkPicture: 0.01, // the quality check of each scene's first frame
  checkScene: 0.01, // the quality check of each 5-second scene
};

/** The quality check remakes at most this many scenes on its own (the spending cap). */
export function maxRedos(scenes: number): number {
  return Math.max(1, Math.ceil(scenes / 3));
}
/** What the quality check always costs: one look at each frame and each scene. */
export function checkCost(scenes: number): number {
  return scenes * (AD_PRICES.checkPicture + AD_PRICES.checkScene);
}
/** The most the automatic remakes can add: a new frame for every scene, and the capped scene remakes. */
export function redoCap(scenes: number): number {
  return scenes * AD_PRICES.picture + maxRedos(scenes) * (AD_PRICES.scene + AD_PRICES.checkScene);
}

export function voiceChars(plan: AdPlan): number {
  return plan.scenes.reduce((n, s) => n + s.voice.length, 0) + plan.endCard.voice.length;
}

export function adCost(plan: AdPlan, withRefs: boolean, check = false): number {
  const n = plan.scenes.length;
  return (
    (check ? checkCost(n) : 0) +
    n * AD_PRICES.scene +
    n * AD_PRICES.picture + // each scene's first frame, showing the same product
    (withRefs ? 0 : AD_PRICES.picture) + // our product picture when there is no photo
    AD_PRICES.picture + // end card
    endCardSeconds(plan.seconds) * AD_PRICES.cardPerSecond +
    (voiceChars(plan) / 1000) * AD_PRICES.voicePer1000Chars +
    Math.ceil(plan.seconds / 60) * AD_PRICES.musicPerMinute +
    plan.seconds * AD_PRICES.editPerSecond * 3
  );
}

/** One scene remade from the chat, plus the re-join and re-mix. */
export function sceneRemakeCost(plan: AdPlan, withRefs: boolean): number {
  void withRefs;
  return AD_PRICES.scene + AD_PRICES.picture + plan.seconds * AD_PRICES.editPerSecond * 2 + 0.01;
}

/** Every bit of text in a plan, for the safety check. */
export function planTexts(plan: AdPlan): string[] {
  return [plan.title, plan.concept, plan.look, plan.music, plan.endCard.headline, plan.endCard.tagline, plan.endCard.voice, ...plan.scenes.flatMap((s) => [s.visual, s.camera, s.text, s.voice])].filter(Boolean);
}

/** The prompt for one scene: the scene plus the shared look, so every scene matches. */
export function scenePrompt(plan: AdPlan, i: number): string {
  const s = plan.scenes[i];
  return `${s.visual}. Camera: ${s.camera}. ${plan.look ? `Keep consistent: ${plan.look}.` : ""} No on-screen text, captions or logos.`.slice(0, 1800);
}

export function endCardPrompt(plan: AdPlan, withRefs: boolean, brand?: BrandInfo): string {
  const b = brandLine(brand);
  return `A clean, premium end card for a video ad.${b ? ` ${b}; use the brand colours for the background and type.` : ""} ${withRefs ? "Show the product from the reference picture exactly as it is, centred, " : `${plan.look}. Show the product centred, `}on a simple background that matches this palette. Large bold headline text that reads exactly "${plan.endCard.headline}"${
    plan.endCard.tagline ? ` and smaller text underneath that reads exactly "${plan.endCard.tagline}"` : ""
  }. Spell every word exactly, nothing else written anywhere. Modern sans-serif type, plenty of space.`;
}
