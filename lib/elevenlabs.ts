// "Connect ElevenLabs": a user can use their own ElevenLabs voices (including a
// cloned brand voice) for Full ad voiceovers, billed to their own ElevenLabs
// account. Until accounts exist, their key lives only in their own browser.
// This file holds the parts that are the same on the server and in the browser.

/** A connected voice is stored in a plan as "el:" plus the ElevenLabs voice id. */
export const OWN_VOICE_PREFIX = "el:";
const OWN_VOICE = /^el:[A-Za-z0-9]{8,40}$/;

export function isOwnVoice(voice: unknown): voice is string {
  return typeof voice === "string" && OWN_VOICE.test(voice);
}
export function ownVoiceId(voice: string): string {
  return voice.slice(OWN_VOICE_PREFIX.length);
}

export type ElevenVoice = { id: string; name: string; category: string };

/**
 * Voices made from a real person's recording need the user's word that they may
 * use that voice. ElevenLabs' stock voices and voices designed from a text
 * description are not anyone's real voice.
 */
export function needsConsent(category: string): boolean {
  return !["premade", "generated"].includes(category);
}

/** Plain words for what kind of voice it is, shown next to its name. */
export function voiceKind(category: string): string {
  if (category === "cloned" || category === "professional") return "your cloned voice";
  if (category === "generated") return "designed voice";
  if (category === "premade") return "ElevenLabs voice";
  return "from your library";
}

/** Reads ElevenLabs' list of voices into the small shape we keep. */
export function parseVoices(data: unknown): ElevenVoice[] {
  const list = (data as { voices?: unknown })?.voices;
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      return { id: String(o.voice_id ?? ""), name: String(o.name ?? "").trim().slice(0, 60), category: String(o.category ?? "") };
    })
    .filter((v) => /^[A-Za-z0-9]{8,40}$/.test(v.id) && v.name)
    .slice(0, 200);
}

// ElevenLabs' best model, Multilingual v2, speaks 26 of our 29 voiceover
// languages. Turbo v2.5 (the one our own voices use) adds the other three.
const TURBO_ONLY: Record<string, string> = { Norwegian: "no", Hungarian: "hu", Vietnamese: "vi" };

/** The request body for one voiceover line in the ad's language. */
export function ttsBody(text: string, language?: string): Record<string, unknown> {
  const code = language ? TURBO_ONLY[language] : undefined;
  return {
    text,
    model_id: code ? "eleven_turbo_v2_5" : "eleven_multilingual_v2",
    ...(code ? { language_code: code } : {}),
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  };
}

/** A key looks like one ElevenLabs gives out (we can't know it works until we ask them). */
export function looksLikeKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{20,120}$/.test(key);
}

/** True for an MP3 file (with or without an ID3 tag at the front). */
export function isMp3(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true; // "ID3"
  return b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
}

export const MAX_VOICE_BYTES = 2 * 1024 * 1024;

/** What ElevenLabs' error means, in plain words. */
export function elevenError(status: number, detail = ""): string {
  const d = detail.toLowerCase();
  if (d.includes("quota") || d.includes("credits") || status === 402) return "Your ElevenLabs account is out of characters. Top it up on elevenlabs.io, or pick one of our voices."
  if (status === 401 && d.includes("permission"))
    return "Your ElevenLabs key isn't allowed to do this. In ElevenLabs, give the key access to Text to Speech and Voices (read), or make a new key.";
  if (status === 401) return "ElevenLabs didn't accept that key. Please check it and connect again.";
  if (d.includes("quota") || d.includes("credits") || status === 402) return "Your ElevenLabs account is out of characters. Top it up on elevenlabs.io, or pick one of our voices.";
  if (status === 404) return "That voice isn't in your ElevenLabs account any more. Pick another voice.";
  if (status === 429) return "ElevenLabs is busy or your plan's limit was reached. Please try again in a minute.";
  return "ElevenLabs had a problem. Please try again, or pick one of our voices.";
}
