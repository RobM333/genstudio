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

export type Purpose = "direct" | "keyframe" | "animate" | "refix";
export type Enhanced = { prompt: string; by: "ai" | "rules" | "none"; note?: string };

const COMMON = `You rewrite short prompts for an AI image and video generator used by creators and marketers.
Rules:
- Keep the user's subject, intent, setting and any details they gave. Never change what they asked for.
- Add only craft details that make the result look professional.
- Do not add real people, celebrities, brands, logos or trademarks the user did not mention.
- Do not add any nudity, sexual content, violence or gore.
- If the user's text is in quotes or they ask for words on screen, keep that text exactly, in quotes.
- Never add any other words, slogans or captions to the image. If the user asked for no text, say "no text".
- If the user names a real, famous person, describe them generically instead (for example "a tall basketball player"), and say so in the note. Never hint at who they are: no "legendary", no famous numbers, signature moves or team.
- For sports, uniforms or products, invent plain team colours and a made-up name or none. Never use real teams, clubs, leagues, jersey numbers tied to famous players, or brand logos.
- Write one paragraph, about 60 to 110 words, in plain English.`;

const PLAIN_REPLY = "Reply with the prompt only. No title, no explanation, no quotes around the whole thing.";
const JSON_REPLY = `Reply with JSON only, like {"prompt": "...", "note": "..."}.
"note" is one short, friendly sentence to the user ONLY if you had to simplify or change their idea (for example "Your idea has three moments; a short clip can show one, so we focused on the dunk."). Otherwise "note" is "".`;

// AI generators often get the *layout* wrong: who is where, which way they face,
// where the camera is, where the light comes from. So for any scene (a product
// shot, a street, a car ad, a kitchen, a sports game) we ask the writer to plan
// the layout first, then describe it in plain words.
const LAYOUT_PLAN = `Before writing, plan the layout of the scene so it is physically real, then describe it clearly:
- Camera: where it stands, its height (eye level, low, high, overhead), the angle and the shot size (wide, medium, close-up), and the lens feel.
- Depth: what is in the foreground, the middle and the background.
- Subjects: where each person, animal or main object is in the frame (left, centre, right) and which way each one faces. People look at what they are paying attention to; a crowd watching something faces it.
- Light: where the main light comes from (for example window on the left, low sun behind), so shadows and reflections fall the same way.
- Scale and physics: sizes make sense next to each other; things rest on surfaces or are held, not floating; reflections match the scene; hands hold objects naturally; text and signs face the camera if they must be read.
- Keep left/right and facing consistent with the camera position you chose.
- For logos, icons or flat graphics, skip camera and light: describe the layout and colours instead.`;


// Motion has its own layout problems: two people getting out of the same car door,
// someone walking through a table. So every moving thing gets its own path.
const MOTION_PLAN = `Plan the movement too:
- Give each person or moving object its own path: where it starts, which way it goes, and where it ends (for example "the driver gets out through the driver's door on the left; the passenger gets out through the passenger door on the right").
- Use the real exit or entry for each one: each person uses their own door, gap or path, never the same one at the same time.
- Say the order: who moves first, then who. Doors open before anyone goes through them.
- Nothing passes through anything else: people don't walk through doors, walls, cars, furniture or each other, and they keep the same size, clothes and look the whole time.`;

// Story-like prompts confuse video models: they mix up who is where and what happens when.
const SHOT_RULES = `${LAYOUT_PLAN}
Video models get confused by stories. Make it ONE clear shot:
${MOTION_PLAN}
- Describe what happens in order, using only what fits in 5 to 10 seconds: one main action.
- If the user describes several moments or a story, keep only the single most important moment and mention this in the note.`;

const STILL_RULES = `${LAYOUT_PLAN}
Describe one frozen moment.`;

function systemPrompt(model: ModelInfo, sound: boolean, purpose: Purpose): string {
  if (purpose === "refix") {
    return `${COMMON}
The user's message has their ORIGINAL description, then "Fix:" and a CORRECTION they wrote after seeing a result they didn't like. Write a new prompt for a fresh ${model.kind === "video" ? "video" : "picture"}:
- Apply the correction fully, even if it changes the camera angle or the layout.
- Keep everything else from the original: the same people, products and objects, their ages and roles (someone watching stays someone watching), the mood, the brand-free look and the setting.
- If the correction says something isn't realistic, work out what would really be seen from that camera position and describe that.
${model.kind === "video" ? SHOT_RULES : STILL_RULES}
${model.kind === "video" ? "Also describe the camera movement and the one main action." : "Describe one frozen moment. Do not describe sound or motion over time."}
${JSON_REPLY}`;
  }
  if (purpose === "keyframe") {
    return `${COMMON}
This still image is the FIRST FRAME of a short video, so get the layout exactly right before anything moves.
${STILL_RULES}
Describe the frozen moment just before the main action starts, with lighting, lens and style. Do not describe sound or motion over time.
${JSON_REPLY}`;
  }
  if (purpose === "animate") {
    const soundLine =
      model.audio && sound
        ? "End with one short sentence describing the sound (ambience, effects, music mood, any spoken line in quotes)."
        : "Do not describe sound.";
    return `${COMMON}
The first frame of this video is already given as a picture, and the layout is already right. Describe only what moves: the one main action in order, how people move, and the camera movement. Keep everyone where they start and facing the way they face. Do not re-describe the whole scene.
${MOTION_PLAN}
 Keep it short, about 40 to 70 words. ${soundLine}
${JSON_REPLY}`;
  }
  if (model.kind === "image") {
    const extra =
      model.id.includes("nano-banana") || model.id.includes("recraft")
        ? "This model is good at text and graphic design. Keep any wording exact, describe layout, typography style and colour palette."
        : "Describe the subject first, then composition and framing, lighting, lens or camera (for photos) or art style (for illustrations), colour palette and mood.";
    return `${COMMON}\nThis is for a still image. ${extra}\n${STILL_RULES}\n${PLAIN_REPLY}`;
  }
  const soundLine =
    model.audio && sound
      ? "This model also makes sound. End with a short sentence describing the sound: ambience, sound effects, music mood, and any spoken line in quotes if the user wants speech."
      : "Do not describe sound.";
  return `${COMMON}
This is for a short video clip (5 to 10 seconds, one shot).
${SHOT_RULES}
Also describe the camera movement (for example slow push-in, orbit, tracking shot, handheld), lighting and mood, and the visual style. ${soundLine}
${JSON_REPLY}`;
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
    if (has("people", "two ", "couple", "friends", "and her", "and his", "car", "door"))
      add.push("each person moves along their own path and uses their own door, nobody passes through objects or each other");
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

/** Reads {"prompt","note"} JSON, tolerating code fences or plain text. */
export function parseReply(raw: string): { prompt: string; note?: string } {
  const t = raw.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const j = JSON.parse(t.slice(start, end + 1)) as { prompt?: unknown; note?: unknown };
      if (typeof j.prompt === "string" && j.prompt.trim()) {
        const note = typeof j.note === "string" && j.note.trim() ? j.note.trim().slice(0, 300) : undefined;
        return { prompt: clean(j.prompt), note };
      }
    } catch {
      // not JSON: fall through and use the text as the prompt
    }
  }
  return { prompt: clean(t.replace(/^```\w*|```$/g, "")) };
}

/** Asks the AI writer on fal.ai. Throws if it fails or takes too long. */
async function enhanceWithAI(
  prompt: string,
  model: ModelInfo,
  sound: boolean,
  purpose: Purpose,
): Promise<{ prompt: string; note?: string }> {
  const { fal } = await import("./fal");
  const call = fal.run("fal-ai/any-llm", {
    input: {
      model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash",
      system_prompt: systemPrompt(model, sound, purpose),
      prompt: `User's description:\n${prompt}`,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("enhancer timed out")), TIMEOUT_MS);
  });
  try {
    const result = (await Promise.race([call, timeout])) as { data?: { output?: string; error?: string } };
    if (result?.data?.error) throw new Error(result.data.error);
    const out = parseReply(result?.data?.output ?? "");
    if (!out.prompt) throw new Error("empty enhancer output");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export async function enhancePrompt(
  prompt: string,
  model: ModelInfo,
  opts: { live: boolean; sound?: boolean; purpose?: Purpose },
): Promise<Enhanced> {
  if (model.needsSource) return { prompt, by: "none" };
  const sound = opts.sound !== false;
  const purpose = opts.purpose ?? "direct";
  if (opts.live) {
    try {
      const r = await enhanceWithAI(prompt, model, sound, purpose);
      return { prompt: r.prompt, note: r.note, by: "ai" };
    } catch (err) {
      console.warn("prompt enhancer fell back to rules:", (err as Error)?.message);
    }
  }
  return { prompt: enhanceWithRules(prompt, model, sound), by: "rules" };
}
