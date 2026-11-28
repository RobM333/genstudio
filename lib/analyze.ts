import { cleanFaults, type FaultCode } from "./promise";

// "Analyze & fix": an AI looks at a finished picture or video, compares it with
// what the user asked for, lists what's off, and suggests a better prompt.
// Pictures use a vision model (about 1 cent); videos use a video model
// (about 1 cent per 5 seconds).

export const IMAGE_ANALYZER = "openrouter/router/vision";
export const VIDEO_ANALYZER = "fal-ai/video-understanding";

export type Analysis = { problems: string[]; fix: string; prompt: string; serious?: boolean; faults?: FaultCode[] };

/** Speech-to-text, used to catch a voice talking in a video when nobody asked for speech (a fraction of a cent). */
export const SPEECH_CHECKER = "fal-ai/whisper";

/**
 * The checking AI's instructions. productNote describes the product, so a
 * finished scene can be checked for the product changing on its way through.
 */
export function analysisInstructions(kind: "image" | "video", userPrompt: string, withProduct = false, productNote = ""): string {
  return `You are a careful film and photo director checking an AI-generated ${kind} against what the user asked for.
The user asked for:
"""${userPrompt.slice(0, 1500)}"""

Look closely at the ${kind}.${withProduct ? " The second picture is the product reference: the product in the first picture must look like it (same shape, colours and label). A different-looking product is a serious problem." : ""} Find up to 4 concrete problems, most important first. Check two things:
1. Does it match the request? Who and what is there, where each one is, which way they face, the camera position, the action${kind === "video" ? " and the order of events" : ""}, and any words (spelled exactly as asked, no extra words).
2. Does it make physical sense? Sightlines (people look at what they are paying attention to), gravity (nothing floats that should rest or be held), light and shadows coming from one consistent direction, reflections that match, hands and bodies (finger count, natural grip), sizes that fit next to each other, perspective and objects placed where they would really be${kind === "video" ? ", and natural motion: people or objects passing through each other or through doors, walls, cars or furniture; two people squeezing out of the same door or path when each should use their own; things changing shape, size or clothes; anything appearing or vanishing. Watch to the very last frame: if a main person or object disappears, turns into smoke, dust or a blur, or leaves the frame when they should stay, that is always a problem" : ""}.
${productNote ? `The product in this ${kind} is: ${productNote.slice(0, 300)}. It must keep the same shape, colours, label and logo from start to finish; any change is a problem.\n` : ""}Also list any real team names, brand logos or famous jersey numbers that appear without the user asking (they make the result unusable). Speech bubbles, captions, subtitles or lettering the user didn't ask for (including names or made-up writing on props such as a director's chair back, a sign, a mug or a screen), and black bars or a dark strip along an edge of the frame, are serious problems. If the request says nobody talks, someone clearly moving their lips as if talking is a problem. Ignore small style differences. Do not name or identify real people.

Then mark only the clear faults: ones anyone would confirm with a yes or no, never taste or style. Use these codes:
- "garbled_text": words on screen are misspelled, scrambled or unreadable gibberish letters (not just a font you dislike). Words the user didn't ask for that are clearly nonsense count too. Only use it when you can actually see letters: copy what you see into "seen_text". If there are no letters anywhere, never use it.
- "product_changed": the product or logo${kind === "video" ? " visibly changes shape, colour, label or design during the video" : " clearly differs from the reference picture"}${withProduct || productNote ? "" : " (only when the request names a specific product)"}.
- "missing_item": a person, animal or object the user clearly named is not there at all${kind === "video" ? " (or vanishes for good)" : ""}.
Leave "faults" empty when unsure.

Reply with JSON only:
{"problems": ["short plain sentence", ...], "seen_text": "the letters you can actually read on screen, copied as they look, or empty if there are none", "faults": ["garbled_text" | "product_changed" | "missing_item", ...], "serious": true or false (true only if a problem makes it clearly wrong or unusable: the wrong product, broken hands or bodies, impossible motion, something important missing or vanishing; false for small issues), "fix": "one instruction for an image editor that fixes the problems, e.g. Make the shadow of the bottle fall to the right, like the others", "prompt": "a complete improved prompt (60 to 110 words) that keeps the user's idea and states the camera position and angle, what is in the foreground and background, where each person or object is and which way it faces, where the light comes from${kind === "video" ? ", and the one main action" : ""}, so the problems don't happen again"}
If nothing is wrong, return an empty problems list.`;
}

const GARBLED = /garbl|gibberish|misspel|scrambled|nonsense (letters|words|text)|unreadable (text|letters|words)|illegible/i;

export function parseAnalysis(raw: string): Analysis | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const problems = Array.isArray(j.problems)
      ? j.problems.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim().slice(0, 200)).slice(0, 4)
      : [];
    const fix = typeof j.fix === "string" ? j.fix.trim().slice(0, 400) : "";
    const prompt = typeof j.prompt === "string" ? j.prompt.trim().slice(0, 1500) : "";
    if (!prompt && problems.length === 0) return null;
    // Checkers sometimes "see" garbled words where there are no letters at all. Without the letters it read, a
    // garbled-words finding is dropped, so nothing is remade or refunded over text that isn't there.
    const seen = typeof j.seen_text === "string" ? j.seen_text.replace(/[\s"'.,-]+/g, "") : "";
    const noLetters = seen.length < 2;
    const kept = noLetters ? problems.filter((p) => !GARBLED.test(p)) : problems;
    // A clear fault always comes with a problem written out, so the person can see it.
    const faults = kept.length ? cleanFaults(j.faults).filter((f) => !(noLetters && f === "garbled_text")) : [];
    if (!prompt && kept.length === 0) return { problems: [], fix: "", prompt: "", serious: false, faults: [] };
    const droppedAll = kept.length === 0 && problems.length > 0;
    return { problems: kept, fix: droppedAll ? "" : fix, prompt, serious: kept.length > 0 && (j.serious === true || faults.length > 0), faults };
  } catch {
    return null;
  }
}
