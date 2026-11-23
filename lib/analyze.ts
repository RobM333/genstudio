// "Analyze & fix": an AI looks at a finished picture or video, compares it with
// what the user asked for, lists what's off, and suggests a better prompt.
// Pictures use a vision model (about 1 cent); videos use a video model
// (about 1 cent per 5 seconds).

export const IMAGE_ANALYZER = "fal-ai/any-llm/vision";
export const VIDEO_ANALYZER = "fal-ai/video-understanding";

export type Analysis = { problems: string[]; fix: string; prompt: string };

export function analysisInstructions(kind: "image" | "video", userPrompt: string): string {
  return `You are a careful film and photo director checking an AI-generated ${kind} against what the user asked for.
The user asked for:
"""${userPrompt.slice(0, 1500)}"""

Look closely at the ${kind}. Find up to 4 concrete problems, most important first. Check two things:
1. Does it match the request? Who and what is there, where each one is, which way they face, the camera position, the action${kind === "video" ? " and the order of events" : ""}, and any words (spelled exactly as asked, no extra words).
2. Does it make physical sense? Sightlines (people look at what they are paying attention to), gravity (nothing floats that should rest or be held), light and shadows coming from one consistent direction, reflections that match, hands and bodies (finger count, natural grip), sizes that fit next to each other, perspective and objects placed where they would really be${kind === "video" ? ", and natural motion with no morphing" : ""}.
Ignore small style differences. Do not name or identify real people.

Reply with JSON only:
{"problems": ["short plain sentence", ...], "fix": "one instruction for an image editor that fixes the problems, e.g. Make the shadow of the bottle fall to the right, like the others", "prompt": "a complete improved prompt (60 to 110 words) that keeps the user's idea and states the camera position and angle, what is in the foreground and background, where each person or object is and which way it faces, where the light comes from${kind === "video" ? ", and the one main action" : ""}, so the problems don't happen again"}
If nothing is wrong, return an empty problems list.`;
}

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
    return { problems, fix, prompt };
  } catch {
    return null;
  }
}
