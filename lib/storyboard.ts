// Length advisor and storyboards.
// A 5 to 10 second clip can only show one clear moment. When an idea has
// several moments, we plan it as a few short shots, each continuing from the
// last frame of the one before, then join them and add one soundtrack.

export type Shot = { prompt: string; seconds: number };
export type ShotPlan = { moments: number; neededSeconds: number; shots: Shot[]; note?: string };

export const MAX_STORY_SECONDS = 30;
export const LONG_LENGTHS = [15, 20, 30];

export function planInstructions(targetSeconds?: number): string {
  return `You plan short videos for an AI video generator. Each shot is ONE clip of about 5 seconds and can show only one clear action.
Read the user's idea and split it into its moments, in order. Then write one shot per moment.
${targetSeconds ? `The user wants about ${targetSeconds} seconds in total, so write ${Math.max(1, Math.round(targetSeconds / 5))} shots (merge or split moments to fit).` : "Use as many shots as the idea needs, at most 6."}
Shot 1 starts at the very beginning of the story (for example the run-up before a jump, or walking in before sitting down), never in the middle of the main action. The last shot ends after the action has finished (for example landing, or the reaction).
Rules for each shot prompt:
- Describe only what moves in that shot, in order, as it continues straight on from the previous shot's last frame.
- Keep the same people, clothes, places and objects in every shot; never introduce new looks.
- Anything that broke, spilled or changed in an earlier shot stays that way in every later shot; say so in each later shot (for example "the backboard frame is still empty, glass shards on the floor").
- Each person keeps their own path and exit; nothing passes through anything else; nobody vanishes.
- No real people, brands, teams or logos.
- 20 to 50 words each.
Reply with JSON only: {"moments": 3, "shots": [{"prompt": "...", "seconds": 5}], "note": "one friendly sentence for the user"}`;
}

/** Reads the planner's JSON reply; returns null if it is unusable. */
export function parsePlan(raw: string, shotSeconds = 5): ShotPlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as { moments?: unknown; shots?: unknown; note?: unknown };
    const shots = (Array.isArray(j.shots) ? j.shots : [])
      .map((s) => (typeof s === "object" && s ? String((s as { prompt?: unknown }).prompt ?? "").trim() : ""))
      .filter((p) => p.length > 0)
      .slice(0, MAX_STORY_SECONDS / 5)
      .map((prompt) => ({ prompt: prompt.slice(0, 600), seconds: shotSeconds }));
    if (shots.length === 0) return null;
    const moments = Math.max(1, Math.min(10, Number(j.moments) || shots.length));
    const note = typeof j.note === "string" && j.note.trim() ? j.note.trim().slice(0, 240) : undefined;
    return { moments, neededSeconds: shots.length * shotSeconds, shots, note };
  } catch {
    return null;
  }
}

/** Simple fallback: split on sentences and "then"/"and then"/"as". */
export function planWithRules(prompt: string, shotSeconds = 5, targetSeconds?: number): ShotPlan {
  const parts = prompt
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\b(?:and then|then|after that|afterwards|finally|meanwhile)\b/i)
    .map((s) => (s ?? "").trim().replace(/^[,;:\s]+|[,;:\s]+$/g, ""))
    .filter((s) => s.split(" ").length >= 3);
  let moments = Math.max(1, parts.length);
  let shots = (parts.length ? parts : [prompt.trim()]).slice(0, MAX_STORY_SECONDS / shotSeconds);
  if (targetSeconds) {
    const want = Math.max(1, Math.min(MAX_STORY_SECONDS / shotSeconds, Math.round(targetSeconds / shotSeconds)));
    while (shots.length > want) {
      // Join the two shortest neighbours.
      const i = shots.length - 2;
      shots = [...shots.slice(0, i), `${shots[i]}, then ${shots[i + 1]}`];
    }
    while (shots.length < want) shots = [...shots, `Continue the scene: ${shots[shots.length - 1]}`];
    moments = Math.max(moments, 1);
  }
  return {
    moments,
    neededSeconds: shots.length * shotSeconds,
    shots: shots.map((p) => ({ prompt: p.slice(0, 600), seconds: shotSeconds })),
  };
}

/** Plain-words advice shown under the prompt. Null when one clip is enough. */
export function lengthAdvice(plan: ShotPlan | null, chosenSeconds?: number): string | null {
  if (!plan || plan.shots.length < 2) return null;
  const s = plan.shots.length;
  const tooShort = chosenSeconds !== undefined && chosenSeconds < plan.neededSeconds;
  return `Your idea has ${plan.moments} moment${plan.moments === 1 ? "" : "s"} and needs about ${plan.neededSeconds} seconds.${
    tooShort ? ` A ${chosenSeconds}s clip will only show one of them clearly.` : ""
  } We recommend ${s} linked shots.`;
}
