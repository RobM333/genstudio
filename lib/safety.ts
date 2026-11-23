// A light first line of defence for prompts. It runs on the server before any
// paid model call. It does NOT catch everything: the AI providers also run
// their own safety checks, and the Acceptable Use Policy still applies.

// Clearly sexual words: blocked with any named or described real person, or any minor.
const SEXUAL = [
  "nude", "naked", "nsfw", "topless", "porn", "porno", "sex", "sexual", "erotic", "undress", "undressed",
  "undressing", "explicit", "xxx", "onlyfans", "genital", "genitals", "fetish", "stripper", "lewd", "nipples",
];
// Suggestive words that are normal in fashion ads: blocked only with minors or clear real-person words.
const SUGGESTIVE = ["sexy", "lingerie", "bikini", "seductive", "boobs", "breasts", "cleavage", "underwear"];

const MINOR = [
  "child", "children", "kid", "kids", "minor", "minors", "teen", "teens", "teenage", "teenager", "underage",
  "schoolgirl", "schoolboy", "girl", "boy", "baby", "toddler", "preteen", "loli", "young-looking",
];
const AGES_UNDER_18 = /\b(1[0-7]|[1-9])[\s-]*(years?[\s-]*old|yo|y\/o)\b/i;

const REAL_PERSON_WORDS = [
  "celebrity", "celebrities", "famous", "actor", "actress", "singer", "rapper", "politician", "president",
  "prime minister", "influencer", "youtuber", "streamer", "athlete", "footballer", "my ex", "my girlfriend",
  "my boyfriend", "my wife", "my husband", "my coworker", "my classmate", "my neighbor", "my neighbour",
  "real person", "photo of her", "photo of him",
];

// Two or more capitalised words in a row, like "Taylor Swift" or "Joe Smith".
const NAME_LIKE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+)+\b/;

function words(prompt: string): Set<string> {
  return new Set(prompt.toLowerCase().split(/[^a-z0-9'-]+/).filter(Boolean));
}

export type SafetyResult = { ok: true } | { ok: false; reason: string };

export function checkPrompt(prompt: string): SafetyResult {
  const w = words(prompt);
  const lower = prompt.toLowerCase();
  const sexual = SEXUAL.some((s) => w.has(s));
  const suggestive = SUGGESTIVE.some((s) => w.has(s));
  // "Undressing" requests are how non-consensual fake nudes are made, so they're always refused.
  if (w.has("undress") || w.has("undressed") || w.has("undressing") || /\b(take|remove|taking|removing) (off )?(her|his|their) clothes\b/i.test(prompt)) {
    return { ok: false, reason: "GenStudio doesn't create undressed or nude versions of people." };
  }
  if (!sexual && !suggestive) return { ok: true };


  if (MINOR.some((m) => w.has(m)) || AGES_UNDER_18.test(prompt)) {
    return { ok: false, reason: "GenStudio never creates sexual content involving minors." };
  }
  const realPerson = REAL_PERSON_WORDS.some((p) => lower.includes(p));
  if (realPerson || (sexual && NAME_LIKE.test(prompt))) {
    return {
      ok: false,
      reason: "GenStudio doesn't create sexual or revealing content of real people. See the Acceptable Use Policy.",
    };
  }
  return { ok: true };
}

/**
 * Extra rules when the user uploaded a real person's photo: nothing sexual,
 * revealing or humiliating, even words that are fine for made-up people.
 */
export function checkWithPersonPhoto(prompt: string): SafetyResult {
  const w = words(prompt);
  if (SEXUAL.some((s) => w.has(s)) || SUGGESTIVE.some((s) => w.has(s)) || ["shirtless", "swimsuit", "bed", "drunk", "naked", "kissing"].some((s) => w.has(s)))
    return { ok: false, reason: "With a real person's photo, GenStudio only makes everyday, fully clothed, respectful scenes." };
  if (/\b(arrest(ed)?|mugshot|crime|prison|jail|blood|injur(ed|y)|dead|corpse|crying)\b/i.test(prompt))
    return { ok: false, reason: "With a real person's photo, GenStudio doesn't make scenes that could embarrass or harm them." };
  return { ok: true };
}
