// Prompt enhancer: turns a short, plain description into a detailed prompt
// written for the specific model that will run it. It keeps what the user
// asked for and only adds craft (lighting, camera, style, motion, sound).
//
// Live mode asks a small, cheap AI writer on fal.ai (about $0.001 a call).
// If that is slow or fails, or in demo mode, a simple rule-based version is
// used instead, so generation never waits on the enhancer.

import type { ModelInfo } from "./models";

const TIMEOUT_MS = 6000;
const MAX_LEN = 1500;

export type Enhanced = { prompt: string; by: "ai" | "rules" | "none" };

const COMMON = `You rewrite short prompts for an AI image and video generator used by creators and marketers.
Rules:
- Keep the user's subject, intent, setting and any details they gave. Never change what they asked for.
- Add only craft details that make the result look professional.
- Do not add real people, celebrities, brands, logos or trademarks the user did not mention.
- Do not add any nudity, sexual content, violence or gore.
- If the user's text is in quotes or they ask for words on screen, keep that text exactly, in quotes.
- Write one paragraph, about 60 to 100 words, in plain English.
- Reply with the prompt only. No title, no explanation, no quotes around the whole thing.`;

function systemPrompt(model: ModelInfo, sound: boolean): string {
  if (model.kind === "image") {
    const extra =
      model.id.includes("imagen") || model.id.includes("recraft")
        ? "This model is good at text and graphic design. Keep any wording exact, describe layout, typography style and colour palette."
        : "Describe the subject first, then composition and framing, lighting, lens or camera (for photos) or art style (for illustrations), colour palette and mood.";
    return `${COMMON}\nThis is for a still image. ${extra}`;
  }
  const soundLine =
    model.audio && sound
      ? "This model also makes sound. End with a short sentence describing the sound: ambience, sound effects, music mood, and any spoken line in quotes if the user wants speech."
      : "Do not describe sound.";
  return `${COMMON}
This is for a short video clip (5 to 10 seconds, one shot). Describe the subject and the setting, what moves and how (subject motion), the camera movement (for example slow push-in, orbit, tracking shot, handheld), lighting and mood, and the visual style. Keep it to one continuous scene. ${soundLine}`;
}

/** Simple fallback used in demo mode or when the AI writer isn't available. */
export function enhanceWithRules(prompt: string, model: ModelInfo, sound = true): string {
  const p = prompt.trim().replace(/[.\s]+$/, "");
  const lower = p.toLowerCase();
  const has = (...w: string[]) => w.some((x) => lower.includes(x));
  const add: string[] = [];
  if (model.kind === "image") {
    const illustration = has("illustration", "cartoon", "vector", "logo", "icon", "flat", "anime", "drawing", "poster");
    if (illustration) add.push("clean composition, bold balanced colours, crisp shapes, professional design quality");
    else {
      if (!has("light")) add.push("soft natural lighting with gentle shadows");
      if (!has("lens", "mm", "camera", "shot")) add.push("shot on a full-frame camera, shallow depth of field");
      add.push("sharp focus, rich detail, professional colour grading");
    }
  } else {
    if (!has("camera", "dolly", "pan", "orbit", "tracking", "push", "zoom", "drone")) add.push("smooth cinematic camera movement");
    if (!has("light")) add.push("natural, flattering light");
    add.push("realistic motion, one continuous shot, high detail, cinematic colour grading");
    if (model.audio && sound && !has("sound", "music", "audio", "voice", "says")) add.push("with matching ambient sound");
  }
  return `${p}, ${add.join(", ")}.`;
}

function clean(text: string): string {
  let t = text.trim();
  t = t.replace(/^(prompt|enhanced prompt)\s*:\s*/i, "");
  if (/^".*"$/s.test(t)) t = t.slice(1, -1).trim();
  return t.slice(0, MAX_LEN);
}

/** Asks the AI writer on fal.ai. Throws if it fails or takes too long. */
async function enhanceWithAI(prompt: string, model: ModelInfo, sound: boolean): Promise<string> {
  const { fal } = await import("./fal");
  const call = fal.run("fal-ai/any-llm", {
    input: {
      model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash",
      system_prompt: systemPrompt(model, sound),
      prompt: `User's description:\n${prompt}`,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("enhancer timed out")), TIMEOUT_MS);
  });
  try {
    const result = (await Promise.race([call, timeout])) as { data?: { output?: string; error?: string } };
    const out = clean(result?.data?.output ?? "");
    if (!out || result?.data?.error) throw new Error(result?.data?.error || "empty enhancer output");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export async function enhancePrompt(
  prompt: string,
  model: ModelInfo,
  opts: { live: boolean; sound?: boolean },
): Promise<Enhanced> {
  if (model.needsSource) return { prompt, by: "none" };
  const sound = opts.sound !== false;
  if (opts.live) {
    try {
      return { prompt: await enhanceWithAI(prompt, model, sound), by: "ai" };
    } catch (err) {
      console.warn("prompt enhancer fell back to rules:", (err as Error)?.message);
    }
  }
  return { prompt: enhanceWithRules(prompt, model, sound), by: "rules" };
}
