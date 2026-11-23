// A picture is one frame. Some ideas (often pasted from a video script)
// describe several shots with a cut between them; a picture model then shows a
// muddle of both, or only half of each. These spot that, so the app can offer
// to make a video instead or keep only the first shot.

const CUT = /\b(?:the shot then|shot then|then cuts?|cuts? to|cutting to|smash cut|jump cut|we cut|transitions? to|dissolves? to|followed by (?:a|an) (?:\w+ )?(?:shot|angle|view)|next shot|second shot|final shot|shot \d|scene \d|in the next scene)\b/i;

export function describesSeveralShots(prompt: string): boolean {
  return CUT.test(prompt);
}

/** The idea up to the first cut: the sentences before the sentence that cuts away. */
export function firstShot(prompt: string): string {
  const m = CUT.exec(prompt);
  if (!m) return prompt.trim();
  const before = prompt.slice(0, m.index);
  // Drop the half sentence that leads into the cut ("The shot then ...", "..., then cuts to").
  const lastStop = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "));
  let shot = (lastStop > 20 ? before.slice(0, lastStop + 1) : before).trim().replace(/[,;:\s-]+(?:and|then)?\s*$/i, "");
  // Keep the look of the whole idea: sentences after the cut that describe light, mood or colour, not action.
  const after = prompt.slice(m.index).split(/(?<=[.!?])\s+/).slice(1);
  const look = after.filter((s) => /\b(light|lighting|lit|mood|palette|colou?r|overcast|sunset|golden hour|atmosphere|tone|grade|grading)\b/i.test(s) && !CUT.test(s));
  if (!/[.!?]$/.test(shot)) shot += ".";
  return [shot, ...look].join(" ").trim();
}
