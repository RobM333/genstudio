// Prompt enhancer: turns a short, plain description into a detailed prompt
// written for the specific model that will run it. It keeps what the user
// asked for and only adds craft (lighting, camera, style, motion, sound).
//
// Live mode asks a small, cheap AI writer on fal.ai (about $0.001 a call).
// If that is slow or fails, or in demo mode, a simple rule-based version is
// used instead, so generation never waits on the enhancer.

import type { ModelInfo } from "./models";
import { firstShot } from "./shots";

const TIMEOUT_MS = 8000;
export const DEFAULT_AVOID = "blur, distortion, morphing, changing faces or clothes, extra limbs, people passing through objects, smoke or dust clouds, broken things repairing themselves, glass reassembling, text, logos";
const MAX_LEN = 1500;

export type Purpose = "direct" | "keyframe" | "animate" | "refix";
export type Enhanced = { prompt: string; by: "ai" | "rules" | "none"; note?: string; avoid?: string };

const COMMON = `You rewrite short prompts for an AI image and video generator used by creators and marketers.
Rules:
- Keep the user's subject, intent, setting and any details they gave. Never change what they asked for.
- Add only craft details that make the result look professional.
- Do not add real people, celebrities, brands, logos or trademarks the user did not mention.
- Do not add any nudity, sexual content, violence or gore.
- If the user's text is in quotes or they ask for words on screen, keep that text exactly, in quotes.
- Write the prompt in English, but if the user writes in another language, any spoken words, dialogue or narration stay in the user's language: put them in quotes in that language and say which language is spoken.
- Never add any other words, slogans or captions to the image. If the user asked for no text, say "no text".
- If the user names a real, famous person, describe them generically instead (for example "a tall basketball player"), and say so in the note. Never hint at who they are: no "legendary", no famous numbers, signature moves or team.
- For sports, uniforms or products, invent plain team colours and a made-up name or none. Never use real teams, clubs, leagues, jersey numbers tied to famous players, or brand logos.
- For pictures, write one paragraph of about 60 to 110 words. For videos, follow the length given below. Plain English.`;

const JSON_REPLY = `Reply with JSON only, like {"prompt": "...", "note": "..."}.
"note" is one short, friendly sentence to the user ONLY if you had to simplify or change their idea (for example "Your idea has three moments; a short clip can show one, so we focused on the dunk."). Otherwise "note" is "".`;
const VIDEO_JSON_REPLY = `Reply with JSON only, like {"prompt": "...", "avoid": "...", "note": "..."}.
"avoid" is a short comma-separated list of things that must not appear (for example "smoke, dust cloud, morphing, changing jersey number, extra people, text, logos, blur").
"note" is one short, friendly sentence to the user ONLY if you had to simplify or change their idea. Otherwise "note" is "".`;

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

// Video models do best with a beat-by-beat timeline that starts at the beginning
// of the action (the run-up) and ends after it (the landing), plus locks that
// stop things changing mid-clip.
function timelineRules(seconds: number): string {
  return `Write the action as a TIMELINE for a ${seconds}-second clip, with times, like "0-2s: ..., 2-3s: ..., 3-${seconds}s: ...":
- Beat 1 is the very start of the action (for example the run-up, the walk in, the car pulling up), never the climax.
- The last beat ends after the action has finished (for example landing on both feet, the door closing, the reaction).
- One clear action per beat, in order, sized to fit the time. If the idea has more than fits in ${seconds} seconds, keep the most important part, start it from its beginning, and say so in the note.
- Camera: say the shot type and one camera move for the whole clip (for example "static wide shot" or "slow push-in"), unless a beat needs a change.
- Physical realism: things obey gravity and real materials (glass breaks into sharp shards that fall and bounce, water splashes and drips, cloth moves with the body); no smoke, dust clouds or explosions unless asked.
- Consistency locks: write one line starting "Keep consistent:" listing what must not change during the clip (same people, faces, outfit, colours, numbers, product shape and label, number of people, setting).
- State persistence: once something breaks, spills, tears, gets wet, lights up or changes, it STAYS that way until the end of the clip. Say it in the beat where it happens and again in the "Keep consistent:" line (for example "the backboard stays shattered with an empty frame after 3s"). Broken things never repair themselves.`;
}

/** How each video model likes to be prompted (from their own prompting guides). */
function modelTips(model: ModelInfo): string {
  if (model.id.includes("kling"))
    return "Kling: write clear 'subject + movement + camera' sentences in the timeline, plain and concrete, 80 to 140 words. Put the unwanted things only in \"avoid\".";
  if (model.id.includes("hailuo") || model.id.includes("minimax"))
    return "Hailuo: describe motion plainly and add one or two camera commands in square brackets where they happen, like [Push in], [Pan left], [Tracking shot], [Static shot]. 70 to 130 words.";
  if (model.id.includes("veo"))
    return "Veo: start with shot type, lens and lighting in one sentence, then the timeline, then the 'Keep consistent:' line. Rich, cinematic, 100 to 170 words.";
  return "80 to 140 words.";
}

const SHOT_RULES = `${LAYOUT_PLAN}
${MOTION_PLAN}`;

const STILL_RULES = `${LAYOUT_PLAN}
Describe one frozen moment.`;

// Ideas pasted from video scripts often describe several shots with a cut; a picture can show one.
const ONE_FRAME = `A picture is ONE frame from ONE camera position. If the description has several shots, a cut, a second angle or events in order, picture only the first shot (keep its camera, subject and action, and keep the overall light, mood and colours), drop the rest, and say so in the note (for example "A picture shows one shot, so we pictured the low-angle bumper shot. Make it a video to get the aerial shot too.").`;

function systemPrompt(model: ModelInfo, sound: boolean, purpose: Purpose, seconds = 5): string {
  if (purpose === "refix") {
    return `${COMMON}
The user's message has their ORIGINAL description, then "Fix:" and a CORRECTION they wrote after seeing a result they didn't like. Write a new prompt for a fresh ${model.kind === "video" ? "video" : "picture"}:
- Apply the correction fully, even if it changes the camera angle or the layout.
- Keep everything else from the original: the same people, products and objects, their ages and roles (someone watching stays someone watching), the mood, the brand-free look and the setting.
- If the correction says something isn't realistic, work out what would really be seen from that camera position and describe that.
${model.kind === "video" ? `${SHOT_RULES}\n${timelineRules(seconds)}\n${modelTips(model)}` : STILL_RULES}
${model.kind === "video" ? VIDEO_JSON_REPLY : `Describe one frozen moment. Do not describe sound or motion over time.\n${JSON_REPLY}`}`;
  }
  if (purpose === "keyframe") {
    return `${COMMON}
This still image is the FIRST FRAME of a short video, so get the layout exactly right before anything moves.
${STILL_RULES}
Describe the OPENING moment of the action, at 0 seconds: the very start (for example the player at the free-throw line before the run-up, the car still driving up, the person outside the door). Never the climax or the middle of the action. Everyone and everything that will appear later must already be in the frame, in their starting places. Include lighting, lens and style. Do not describe sound or motion over time.
${JSON_REPLY}`;
  }
  if (purpose === "animate") {
    const soundLine =
      model.audio && sound
        ? "End with one short sentence describing the sound (ambience, effects, music mood, any spoken line in quotes)."
        : "Do not describe sound.";
    return `${COMMON}
The first frame of this video is already given as a picture, and the layout is already right: it is 0s of your timeline. Describe only what moves, starting from that frame. Keep everyone where they start and facing the way they face. Do not re-describe the whole scene. You cannot see the picture, so never mention colours, clothes, looks or objects the user did not mention; in "Keep consistent:" say "same people, outfits, colours and numbers as the first frame". Keep every step the user asked for (for example landing back on the floor).
${MOTION_PLAN}
${timelineRules(seconds)}
${modelTips(model)} ${soundLine}
${VIDEO_JSON_REPLY}`;
  }
  if (model.kind === "image") {
    const extra =
      model.id.includes("nano-banana") || model.id.includes("recraft")
        ? "This model is good at text and graphic design. Keep any wording exact, describe layout, typography style and colour palette."
        : "Describe the subject first, then composition and framing, lighting, lens or camera (for photos) or art style (for illustrations), colour palette and mood.";
    return `${COMMON}\nThis is for a still image. ${extra}\n${STILL_RULES}\n${ONE_FRAME}\n${JSON_REPLY}`;
  }
  const soundLine =
    model.audio && sound
      ? "This model also makes sound. End with a short sentence describing the sound: ambience, sound effects, music mood, and any spoken line in quotes if the user wants speech."
      : "Do not describe sound.";
  return `${COMMON}
This is for a short video clip (${seconds} seconds, one continuous shot).
${SHOT_RULES}
${timelineRules(seconds)}
Also give the lighting, mood and visual style. ${modelTips(model)} ${soundLine}
${VIDEO_JSON_REPLY}`;
}

function refNote(kinds: string[]): string {
  if (kinds.length === 0) return "";
  return `\nThe user also gives their own pictures of: ${kinds.join(", ")}. They are shown to the image model. Do not describe how those look (no colours, shapes, labels, faces or clothes for them); call them "the product", "the logo", "the person". Describe the new scene around them: setting, layout, camera, light.`;
}

/** Simple fallback used in demo mode or when the AI writer isn't available. */
export function enhanceWithRules(prompt: string, model: ModelInfo, sound = true): string {
  const p = (model.kind === "image" ? firstShot(prompt) : prompt).trim().replace(/[.\s]+$/, "");
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
export function parseReply(raw: string): { prompt: string; note?: string; avoid?: string } {
  const t = raw.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const j = JSON.parse(t.slice(start, end + 1)) as { prompt?: unknown; note?: unknown; avoid?: unknown };
      if (typeof j.prompt === "string" && j.prompt.trim()) {
        const note = typeof j.note === "string" && j.note.trim() ? j.note.trim().slice(0, 300) : undefined;
        const avoid = typeof j.avoid === "string" && j.avoid.trim() ? j.avoid.trim().slice(0, 300) : undefined;
        return { prompt: clean(j.prompt), note, avoid };
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
  refKinds: string[] = [],
  seconds = 5,
): Promise<{ prompt: string; note?: string; avoid?: string }> {
  const { fal } = await import("./fal");
  const call = fal.run("fal-ai/any-llm", {
    input: {
      model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash",
      system_prompt: systemPrompt(model, sound, purpose, seconds) + refNote(refKinds),
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
  opts: { live: boolean; sound?: boolean; purpose?: Purpose; refKinds?: string[]; seconds?: number },
): Promise<Enhanced> {
  if (model.needsSource) return { prompt, by: "none" };
  const sound = opts.sound !== false;
  const purpose = opts.purpose ?? "direct";
  if (opts.live) {
    try {
      const r = await enhanceWithAI(prompt, model, sound, purpose, opts.refKinds ?? [], opts.seconds ?? 5);
      return { prompt: r.prompt, note: r.note, avoid: r.avoid, by: "ai" };
    } catch (err) {
      console.warn("prompt enhancer fell back to rules:", (err as Error)?.message);
    }
  }
  return {
    prompt: enhanceWithRules(prompt, model, sound),
    avoid: model.kind === "video" ? DEFAULT_AVOID : undefined,
    by: "rules",
  };
}
