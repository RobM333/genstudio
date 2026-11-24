// Saved characters: a brand's own recurring person (a presenter, a mascot
// person, an "AI influencer") that keeps the same face in every picture,
// video, ad and film. The user describes an invented person, or uses their
// own photo (or a photo of someone who agreed). We then make one "look
// picture" of them: a front portrait and a full-body view on a plain
// background. That picture is what every later job is shown, so the face is
// held by a picture, not by words. Outfits and settings can change each time.
//
// Rules: invented people or the user's own likeness with consent only. Never
// a real or famous person, or someone made to look like one.

export type Character = {
  id: string;
  name: string; // a first name or a nickname, used to say who is who in a scene
  look: string; // face, hair, skin tone, age and build: the parts that never change
  outfit: string; // what they usually wear; each film or post can change it
  photo?: { url: string; token: string }; // the user's own checked photo of them, if any
  sheetUrl?: string; // their look picture
  sheetToken?: string; // the server's signature: it may be used as a person reference
  createdAt: number;
};

export const MAX_CHARACTERS = 6;

const LOOKALIKE = /\b(look(s|ing)?[\s-]*like|look-?alike|resembl\w*|double of|twin of|impersonat\w*|in the style of|celebrit\w*|famous|actor|actress|singer|rapper|politician|president|athlete|footballer|youtuber|influencer named)\b/i;
const MINOR = /\b(child|children|kid|kids|minor|teen|teens|teenage|teenager|underage|schoolgirl|schoolboy|girl|boy|baby|toddler|preteen)\b/i;
const AGE = /\b(\d{1,2})[\s-]*(years?[\s-]*old|yo|y\/o)\b/i;

export type CharacterCheck = { ok: true } | { ok: false; reason: string };

/** Checks a character before its look picture is made or saved. */
export function checkCharacter(c: { name: string; look: string; outfit: string }): CharacterCheck {
  const all = `${c.name} ${c.look} ${c.outfit}`;
  if (!c.name.trim()) return { ok: false, reason: "Give your character a first name, so you can tell who is who in a scene." };
  if (c.name.trim().split(/\s+/).length > 2 || c.name.length > 24)
    return { ok: false, reason: "Use a short first name or nickname for your character, like “Mia” or “Coach Dan”." };
  if (LOOKALIKE.test(all))
    return { ok: false, reason: "Characters must be invented people, or you (or someone who agreed) from a photo. They can't be made to look like a real or famous person." };
  const age = AGE.exec(all);
  if (MINOR.test(all) || (age && Number(age[1]) < 18)) return { ok: false, reason: "Characters must be adults (18 or older)." };
  if (!c.look.trim() && !c.outfit.trim()) return { ok: false, reason: "Describe how they look: face, hair, age and build." };
  return { ok: true };
}

/** The name used inside prompts: the first word only, so no full real name gets through. */
export function promptName(name: string): string {
  return (name.trim().split(/\s+/)[0] || "Character").replace(/[^\p{L}\p{N}'-]/gu, "").slice(0, 20) || "Character";
}

/** The prompt for a character's look picture. */
export function sheetPrompt(c: { look: string; outfit: string }, fromPhoto: boolean): string {
  const who = fromPhoto ? "the person in Image 1, exactly as they are" : `one invented adult person: ${c.look.trim().replace(/[.\s]+$/, "")}`;
  const wear = c.outfit.trim() ? ` Wearing ${c.outfit.trim().replace(/[.\s]+$/, "")}.` : "";
  return `Character look sheet of ${who}.${wear} Two views side by side on a plain light grey studio background: on the left a front-facing head-and-shoulders portrait, on the right a full-body front view standing naturally. The same person in both views. Soft even studio light, sharp focus, natural skin texture, photoreal. No text, no logos.`;
}

/** The saved characters as person references, so they work anywhere reference pictures do. */
export function characterRefs(list: Character[] | undefined): { url: string; kind: "person"; token: string; name: string }[] {
  return (list ?? [])
    .filter((c) => c.sheetUrl && c.sheetToken)
    .map((c) => ({ url: c.sheetUrl!, kind: "person" as const, token: c.sheetToken!, name: c.name }));
}

/** Reminder shown when downloading something with a realistic AI person in it. */
export const AI_LABEL_NOTE =
  "This shows a realistic AI-made person. TikTok, Instagram, Facebook and YouTube ask you to label realistic AI content when you post it (use their “AI-generated” or “made with AI” label).";
