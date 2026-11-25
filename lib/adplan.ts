// Full ad mode: the user describes a product, who it's for, the length and the
// tone. We plan a concept and a scene-by-scene script they can review and edit
// before anything is paid for. Then every scene is made, a voiceover and music
// are added, and it all comes back as one finished video.

export type AdScene = {
  visual: string; // what we see
  camera: string; // shot type and one move
  text: string; // short on-screen words (shown in the plan; the end card carries the words in the video)
  voice: string; // the voiceover line for this scene
  /**
   * Who says the line. "character": someone on screen says it to camera (Kling 3
   * makes the voice and mouth together; with the user's own voice or another
   * language, the voice is made first and the lips matched to it). "voiceover" (or missing, for older plans): a narrator over the
   * pictures, and nobody on screen talks.
   */
  speaker?: Speaker;
};

export type Speaker = "voiceover" | "character";
/** A scene whose line is said on screen, with the lips matched to the voice. */
export const speaksOnScreen = (s: { speaker?: Speaker; voice: string }) => s.speaker === "character" && s.voice.trim().split(/\s+/).length >= 2;

export type AdPlan = {
  title: string;
  concept: string;
  look: string; // the consistency lock: product, people, colours, setting, light
  music: string;
  voice: string; // voice name
  scenes: AdScene[];
  endCard: { headline: string; tagline: string; voice: string };
  seconds: number;
  /** The person asked for words on screen; otherwise scenes carry no writing at all. */
  allowText?: boolean;
};

import { brandLine, type BrandInfo } from "./brand";
import { isOwnVoice } from "./elevenlabs";

export type AdBrief = { product: string; audience: string; seconds: number; tone: string; refKinds?: string[]; refNames?: string[]; brand?: BrandInfo; language?: string };

/** The kinds of reference picture the planner may hear about. */
export const PLAN_REF_KINDS = ["product", "logo", "person", "character", "style"];

/** Did the person ask for words on screen (captions, a speech bubble, a sign)? If not, scenes carry none. */
export function wantsOnScreenText(text: string): boolean {
  return /\b(captions?|subtitles?|speech bubbles?|text on screen|on-screen (text|words)|title card|lower third|written (on|across)|says? in (big |bold )?(letters|text))\b/i.test(text);
}

/** Voiceover languages: the voice model speaks the language its lines are written in. */
export const AD_LANGUAGES = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Polish", "Swedish", "Danish", "Norwegian", "Finnish",
  "Greek", "Czech", "Romanian", "Hungarian", "Ukrainian", "Russian", "Turkish", "Arabic", "Hindi", "Tamil", "Indonesian", "Malay",
  "Filipino", "Vietnamese", "Japanese", "Korean", "Chinese",
] as const;
const BROWSER_LANG: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish", sv: "Swedish", da: "Danish",
  no: "Norwegian", nb: "Norwegian", nn: "Norwegian", fi: "Finnish", el: "Greek", cs: "Czech", ro: "Romanian", hu: "Hungarian", uk: "Ukrainian",
  ru: "Russian", tr: "Turkish", ar: "Arabic", hi: "Hindi", ta: "Tamil", id: "Indonesian", ms: "Malay", fil: "Filipino", tl: "Filipino",
  vi: "Vietnamese", ja: "Japanese", ko: "Korean", zh: "Chinese",
};
/** The voiceover language to start with: the browser's language when we support it. */
export function languageFromLocale(locale?: string): string {
  return BROWSER_LANG[String(locale ?? "").toLowerCase().split("-")[0]] ?? "English";
}
export function adLanguage(l: unknown): string {
  return (AD_LANGUAGES as readonly string[]).includes(String(l)) ? String(l) : "English";
}
/** Languages written without spaces: their lines are limited by characters instead of words. */
const NO_SPACES = ["Japanese", "Chinese"];
export function maxVoiceChars(seconds: number, language?: string): number | null {
  return language && NO_SPACES.includes(language) ? Math.max(8, Math.floor(seconds * 5)) : null;
}

export const AD_LENGTHS = [15, 30, 60] as const;
export const AD_TONES = ["Friendly", "Premium", "Energetic", "Funny", "Calm"] as const;
export const SCENE_SECONDS = 5;
/** Our built-in voices. Each label says the accent, and American is the default. */
export const AD_VOICES: { id: string; label: string; accent: string }[] = [
  { id: "Rachel", label: "Warm female, American", accent: "American" },
  { id: "Sarah", label: "Soft female, American", accent: "American" },
  { id: "Aria", label: "Confident female, American", accent: "American" },
  { id: "Brian", label: "Deep male, American", accent: "American" },
  { id: "Roger", label: "Relaxed male, American", accent: "American" },
  { id: "Charlie", label: "Upbeat male, Australian", accent: "Australian" },
];
export const DEFAULT_VOICE = "Rachel";

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
/** About how long a line takes to say, in seconds (a lip-matched scene lasts as long as its line). */
export function lineSeconds(line: string, language?: string): number {
  const n = maxVoiceChars(1, language) ? line.length / 5 : line.trim().split(/\s+/).filter(Boolean).length / 2.5;
  return Math.min(8, Math.max(2, n + 0.6));
}

const JSON_SHAPE = `{"title":"...","concept":"two sentences","look":"...","music":"...","voice":"Rachel","scenes":[{"visual":"...","camera":"...","text":"...","voice":"...","speaker":"voiceover"}],"endCard":{"headline":"...","tagline":"...","voice":"..."}}`;

export function adPlanInstructions(brief: AdBrief): string {
  const n = sceneCount(brief.seconds);
  const card = endCardSeconds(brief.seconds);
  const kinds = brief.refKinds ?? [];
  const charIdx = kinds.indexOf("character");
  const charName = charIdx >= 0 ? (brief.refNames?.[charIdx] ?? "").trim() : "";
  const productKinds = kinds.filter((k) => k !== "character");
  const refs = [
    productKinds.length
      ? `The user uploaded their own ${productKinds.join(" and ")} picture(s). Every scene that shows the product must show it exactly as in their picture; describe it plainly as "the product" and never invent a different design, colour or label.`
      : charIdx >= 0
        ? "The user's own character or mascot is the star (see below). Only describe a separate product if the brief names one."
        : "The user did not upload a product picture, so describe the product's look once, clearly, in the look line, and keep it identical in every scene.",
    charIdx >= 0
      ? `The user uploaded their own character or mascot${charName ? ` called "${charName}"` : ""}. It is a character, not a product: it acts, moves and can talk. Call it ${charName ? `"${charName}"` : `"the character"`} in every scene, show it exactly as in their picture (same design, colours, outfit and accessories) and never put it on a screen, poster or package.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const allowText = wantsOnScreenText(`${brief.product} ${brief.audience}`);
  const brand = brandLine(brief.brand);
  return `You are an award-winning ad creative director. Plan a ${brief.seconds}-second video ad.
Tone: ${brief.tone}. ${refs}
Language: write every "voice" line, every "text", and the end card "headline", "tagline" and "voice" in ${adLanguage(brief.language)}, natural for native speakers (keep a brand or product name as it is). Write everything else ("visual", "camera", "look", "music", "title", "concept") in English.${brand ? `\nThe brand kit: ${brand}. Use the brand colours in the look line (setting, props, light) and on the end card, follow the brand style, and use the brand name on the end card.` : ""}
Write exactly ${n} scenes of ${SCENE_SECONDS} seconds each, then an end card of ${card} seconds.
Rules:
- Open with a hook in scene 1 (a striking moment, a problem the audience feels, or a surprising visual). Show the product in use, the benefit, then the payoff. The end card has the product name and a short call to action.
- Each scene "visual": one clear action in ${SCENE_SECONDS} seconds, 20 to 45 words, describing what we see and what moves. ${allowText ? "Only the words the user asked for may appear on screen; nothing else is written anywhere." : "Nothing written anywhere: no speech bubbles, captions, subtitles, signs, labels or lettering on props (a clapperboard or sign is blank). AI video garbles words."} Never put spoken words or quotes in "visual": the line goes in "voice". No real people, celebrities, brands, teams or logos. Adults only.
- "camera": shot type and one move, for example "close-up, slow push-in" or "wide shot, gentle pan right".
- "look": one line listing what must stay the same in every scene: the product's shape, colour and label, each person's age, hair and outfit, the colour palette, the setting and the light. This is repeated into every scene so they match.
- "text": up to 5 words of on-screen copy for that moment (shown in the plan; the words are rendered on the end card).
- "voice": the line for that scene, at most ${maxVoiceChars(SCENE_SECONDS, brief.language) ? `${maxVoiceChars(SCENE_SECONDS, brief.language)} characters` : `${maxVoiceWords(SCENE_SECONDS)} words`}, one or two complete sentences (never cut off), natural and spoken, matching the ${brief.tone.toLowerCase()} tone. Together the lines tell one short story.
- "speaker": "character" when a person or character on screen says the line themselves (their lips will be matched to the voice), otherwise "voiceover" for a narrator. For a "character" scene, the visual shows that one speaker facing the camera in a medium shot or close-up, face and mouth clearly visible, with a small gesture, and no one else talking. For a "voiceover" scene, nobody on screen talks or moves their lips. One voice reads every line, so only one character speaks in the whole ad.${kinds.includes("person") ? ' The user gave a photo of a real person, so every "speaker" is "voiceover".' : ""}
- "music": genre, mood and tempo for an instrumental background bed, no vocals.
- "voice" (top level): pick one of ${AD_VOICES.map((v) => `${v.id} (${v.label})`).join(", ")}. Use an American voice unless the brief asks for another accent.
- "endCard": "headline" is the product name or a 2 to 4 word promise, "tagline" is a call to action up to 6 words, "voice" says it in at most ${maxVoiceChars(card, brief.language) ? `${maxVoiceChars(card, brief.language)} characters` : `${maxVoiceWords(card)} words`}.
Reply with JSON only, in this shape: ${JSON_SHAPE}`;
}

export function revisePlanInstructions(brief: AdBrief): string {
  return `${adPlanInstructions(brief)}
You are now editing an existing plan. Apply the user's change request, keep everything else exactly the same, and keep the same number of scenes. Reply with the whole updated plan as JSON only.`;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const wordsMax = (s: string, n: number) => s.split(" ").slice(0, n).join(" ");
const words = (s: string) => s.split(" ").filter(Boolean).length;
/**
 * Fits a voice line to its seconds without cutting a sentence in half: whole
 * sentences are kept while they fit, a line only a little long is kept whole
 * (people say it a bit faster), and only a very long single sentence is
 * shortened, at a comma where there is one.
 */
export function fitLine(s: string, seconds: number, language?: string): string {
  const chars = maxVoiceChars(seconds, language);
  const max = chars ?? maxVoiceWords(seconds);
  const size = (t: string) => (chars ? t.length : words(t));
  if (size(s) <= max) return s;
  const sentences = s.match(/[^.!?。！？]+[.!?。！？]+["”’']?\s*|[^.!?。！？]+$/g)?.map((x) => x.trim()) ?? [s];
  let kept = "";
  for (const sent of sentences) {
    const next = kept ? `${kept}${chars ? "" : " "}${sent}` : sent;
    if (size(next) > max) break;
    kept = next;
  }
  if (kept) return kept;
  if (size(s) <= max + 2) return s;
  if (chars) return s.slice(0, chars);
  const cut = wordsMax(s, max);
  const comma = cut.lastIndexOf(",");
  const clause = comma > cut.length / 2 ? cut.slice(0, comma) : cut.replace(/\s+(and|or|but|to|the|a|an|of|with|for|so|your|our|you)$/i, "");
  return `${clause.replace(/[,;:\s]+$/, "")}.`;
}

/** Reads the planner's JSON reply and fits it to the length; null if it is unusable. */
/** keepVoice: the user's own ElevenLabs voice in the plan being changed, which the planner may keep. */
export function parseAdPlan(raw: string, brief: AdBrief, keepVoice?: string): AdPlan | null {
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
          voice: fitLine(clip(o.voice, 200), SCENE_SECONDS, brief.language),
          // A real person's photo is never made to say words in one of our voices ("You, talking" is for that, with their own voice).
          speaker: (o.speaker === "character" && !brief.refKinds?.includes("person") ? "character" : "voiceover") as Speaker,
        };
      })
      .filter((s) => s.visual.length > 8)
      .slice(0, n);
    if (scenes.length < n) return null;
    const ec = (j.endCard ?? {}) as Record<string, unknown>;
    // A built-in voice the planner picked, else the user's own voice they already chose, else Rachel.
    const voice = AD_VOICES.some((v) => v.id === j.voice) ? String(j.voice) : isOwnVoice(keepVoice) ? keepVoice : DEFAULT_VOICE;
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
        voice: fitLine(clip(ec.voice, 160), endCardSeconds(brief.seconds), brief.language),
      },
      seconds: brief.seconds,
      allowText: wantsOnScreenText(`${brief.product} ${brief.audience}`) || undefined,
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
    voice: brief.tone === "Energetic" ? "Aria" : DEFAULT_VOICE,
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
  talkPerSecond: 0.115, // Kling AI Avatar v2 Pro: lips matched to a recorded voice (own ElevenLabs voice or not English; checked on fal.ai 2026-11-25)
  nativeTalkPerSecond: 0.168, // Kling 3 Pro with sound: voice and mouth made together in one step (checked on fal.ai 2026-11-25)
};

/**
 * A scene said on screen is made in one step by Kling 3 (it speaks the line itself, mouth and voice together) when
 * one of our built-in voices reads the ad in English. The user's own ElevenLabs voice, or another language, keeps
 * the voice-first way: the line is recorded, then the lips are matched to that recording.
 */
export function nativeTalk(voice: string | undefined, language?: string): boolean {
  return !isOwnVoice(voice) && (!language || language === "English");
}

/** Our built-in voice in words, for the one-step talking model ("a relaxed male American voice"). */
export function voiceInWords(voice: string | undefined): string {
  const v = AD_VOICES.find((x) => x.id === voice) ?? AD_VOICES.find((x) => x.id === DEFAULT_VOICE)!;
  const [feel, accent] = v.label.split(",").map((t) => t.trim().toLowerCase());
  return `a ${feel} ${accent.charAt(0).toUpperCase()}${accent.slice(1)} voice`;
}

/** The video part of one scene: a one-step talking scene is 5 seconds; a lip-matched one lasts as long as its line. */
export function sceneVideoCost(scene: AdScene, language?: string, voice?: string): number {
  if (!speaksOnScreen(scene)) return AD_PRICES.scene;
  return nativeTalk(voice, language) ? SCENE_SECONDS * AD_PRICES.nativeTalkPerSecond : (lineSeconds(scene.voice, language) + 0.5) * AD_PRICES.talkPerSecond;
}
/** The dearest scene of the plan, used for the spending cap on automatic remakes. */
function dearestScene(plan?: AdPlan): number {
  return Math.max(AD_PRICES.scene, ...(plan?.scenes ?? []).map((s) => sceneVideoCost(s, undefined, plan?.voice)));
}

/** The quality check remakes at most this many scenes on its own (the spending cap). */
export function maxRedos(scenes: number): number {
  return Math.max(1, Math.ceil(scenes / 3));
}
/** What the quality check always costs: one look at each frame and each scene. */
export function checkCost(scenes: number): number {
  return scenes * (AD_PRICES.checkPicture + AD_PRICES.checkScene);
}
/** The most the automatic remakes can add: a new frame for every scene, and the capped scene remakes. */
export function redoCap(scenes: number, plan?: AdPlan): number {
  return scenes * AD_PRICES.picture + maxRedos(scenes) * (dearestScene(plan) + AD_PRICES.checkScene);
}

export function voiceChars(plan: AdPlan): number {
  return plan.scenes.reduce((n, s) => n + s.voice.length, 0) + plan.endCard.voice.length;
}

export function adCost(plan: AdPlan, withRefs: boolean, check = false): number {
  const n = plan.scenes.length;
  return (
    (check ? checkCost(n) : 0) +
    plan.scenes.reduce((t, s) => t + sceneVideoCost(s, undefined, plan.voice), 0) + // a filmed scene, or a scene said on screen
    n * AD_PRICES.picture + // each scene's first frame, showing the same product
    (withRefs ? 0 : AD_PRICES.picture) + // our product picture when there is no photo
    AD_PRICES.picture + // end card
    endCardSeconds(plan.seconds) * AD_PRICES.cardPerSecond +
    (isOwnVoice(plan.voice) ? 0 : (voiceChars(plan) / 1000) * AD_PRICES.voicePer1000Chars) + // a connected ElevenLabs voice is billed to the user's ElevenLabs
    Math.ceil(plan.seconds / 60) * AD_PRICES.musicPerMinute +
    plan.seconds * AD_PRICES.editPerSecond * 3
  );
}

/** One scene remade from the chat, plus the re-join and re-mix. */
export function sceneRemakeCost(plan: AdPlan, withRefs: boolean): number {
  void withRefs;
  return dearestScene(plan) + AD_PRICES.picture + plan.seconds * AD_PRICES.editPerSecond * 2 + 0.01;
}

/** Every bit of text in a plan, for the safety check. */
export function planTexts(plan: AdPlan): string[] {
  return [plan.title, plan.concept, plan.look, plan.music, plan.endCard.headline, plan.endCard.tagline, plan.endCard.voice, ...plan.scenes.flatMap((s) => [s.visual, s.camera, s.text, s.voice])].filter(Boolean);
}

/** The prompt for one scene: the scene plus the shared look, so every scene matches. */
export function scenePrompt(plan: AdPlan, i: number, asVoiceover = false): string {
  const s = plan.scenes[i];
  const who = speaksOnScreen(s) && !asVoiceover
    ? "The one speaker faces the camera, face and mouth clearly visible, ready to talk."
    : "Nobody on screen talks: mouths stay closed, no lip movement.";
  return `${withoutDialogue(s.visual)}. Camera: ${s.camera}. ${plan.look ? `Keep consistent: ${plan.look}.` : ""} ${who} ${plan.allowText ? "No captions or logos." : NO_TEXT} ${FULL_FRAME}`
    .replace(/\.\s*\./g, ".")
    .slice(0, 1800);
}

/**
 * The prompt for a scene said on screen in one step: the line is written in the prompt in quotes and the voice is
 * described in words, so the model makes the voice and the moving mouth together.
 */
export function talkScenePrompt(plan: AdPlan, i: number, fix = ""): string {
  const s = plan.scenes[i];
  const line = s.voice.trim().replace(/["“”]/g, "'");
  const scene = `${fix ? `Important: ${fix} ` : ""}${withoutDialogue(s.visual)}. Camera: ${s.camera}. ${plan.look ? `Keep consistent: ${plan.look}.` : ""}`.replace(/\.\s*\./g, ".");
  const rest = `Only this one character speaks, nothing else is said. ${plan.allowText ? "No captions or logos." : NO_TEXT} ${FULL_FRAME}`;
  const say = `The character stays exactly as in the picture and speaks straight to camera in ${voiceInWords(plan.voice)}, with natural pauses and lively expressions, the mouth clearly moving with every word: "${line}"`;
  // The spoken line is never cut: the scene description gives way first.
  return `${scene.slice(0, Math.max(200, 1500 - say.length - rest.length - 2))} ${say} ${rest}`.slice(0, 1500);
}

/** Said in every scene prompt unless the person asked for words on screen. */
export const NO_TEXT = "No speech bubbles, captions, subtitles, logos, signs or written words anywhere; every prop is blank: a director's chair back is plain fabric with no name, and clapperboards, mugs, screens, papers and walls have no lettering.";
/** Cinematic scenes sometimes come back with black bars, which show as a dark strip in the joined ad. */
export const FULL_FRAME = "Full frame, edge to edge, no black bars, borders or letterbox.";
/** Things the video model is told to leave out (its "negative prompt"). */
export const SCENE_AVOID = "speech bubble, caption, subtitles, text, letters, words, sign, name on chair, watermark, logo, black bars, letterbox, border";

/**
 * Spoken words inside a scene's picture description make picture models draw
 * them as a speech bubble or caption, so the quoted words are taken out (the
 * line is spoken by the voice instead).
 */
export function withoutDialogue(visual: string): string {
  return visual
    .replace(/[,:]?\s*["“][^"”]{1,200}["”]/g, "")
    .replace(/\s+(saying|says|that reads|reading)\s*(?=[,.;]|$)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim()
    .replace(/[.]+$/, "");
}

export function endCardPrompt(plan: AdPlan, withRefs: boolean, brand?: BrandInfo, kinds: string[] = []): string {
  const b = brandLine(brand);
  const subject = !withRefs
    ? `${plan.look}. Show the product centred, `
    : kinds.includes("character") && !kinds.includes("product")
      ? "Show the character from the reference picture exactly as it is (same outfit and accessories, nothing added such as hats, caps or jackets), centred, "
      : "Show the product from the reference picture exactly as it is, centred, ";
  return `A clean, premium end card for a video ad.${b ? ` ${b}; use the brand colours for the background and type.` : ""} ${subject}on a simple background that matches this palette. Large bold headline text that reads exactly "${plan.endCard.headline}"${
    plan.endCard.tagline ? ` and smaller text underneath that reads exactly "${plan.endCard.tagline}"` : ""
  }. Spell every word exactly, nothing else written anywhere. Modern sans-serif type, plenty of space.`;
}

/** How the opening frame is told to use the reference pictures: a mascot is kept as a character, not as "the product". */
export function frameLead(kinds: string[]): string {
  const parts: string[] = [];
  if (kinds.includes("character")) parts.push("The character from the reference picture is the star: keep its exact look (face, shape, colours, outfit and accessories) and keep it a character, never a real person. It is life-size for its world and stands naturally on the floor or sits on a seat: behind a counter or table, never standing on top of furniture or floating.");
  if (kinds.includes("product") || !kinds.length) parts.push("The product must look exactly like the product in the reference picture.");
  if (kinds.includes("logo")) parts.push("Only use the logo where the scene says so.");
  return `Opening frame of a video ad scene. ${parts.join(" ")}`;
}
