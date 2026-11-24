"use client";

// The user's ElevenLabs connection, kept only in this browser until accounts
// arrive. The key goes straight from the browser to ElevenLabs. Only if the
// browser can't reach ElevenLabs does it pass through our server for that one
// request, and our server never stores or logs it.

import { checkPrompt } from "@/lib/safety";
import { elevenError, needsConsent, ownVoiceId, parseVoices, ttsBody, type ElevenVoice } from "@/lib/elevenlabs";

export type ElevenConnection = { key: string; voices: ElevenVoice[]; consented: string[] };

const STORE = "genstudio.elevenlabs.v1";
const API = "https://api.elevenlabs.io/v1";

export function loadEleven(): ElevenConnection | null {
  try {
    const raw = localStorage.getItem(STORE);
    const c = raw ? (JSON.parse(raw) as ElevenConnection) : null;
    if (c && typeof c.key === "string" && c.key)
      return { key: c.key, voices: Array.isArray(c.voices) ? c.voices : [], consented: Array.isArray(c.consented) ? c.consented.map(String) : [] };
  } catch {
    // nothing saved, or storage blocked
  }
  return null;
}

export function saveEleven(c: ElevenConnection | null) {
  try {
    if (c) localStorage.setItem(STORE, JSON.stringify(c));
    else localStorage.removeItem(STORE);
  } catch {
    // storage blocked: the connection lasts until the page closes
  }
}

/** The connected voices that can be used now: a cloned voice only after the user's consent tick. */
export function usableVoices(c: ElevenConnection | null): ElevenVoice[] {
  if (!c) return [];
  return c.voices.filter((v) => !needsConsent(v.category) || c.consented.includes(v.id));
}

/** Calls ElevenLabs from the browser, or through our pass-through if the browser is blocked. */
async function call(key: string, path: string, init: RequestInit, viaUs: Record<string, unknown>): Promise<Response> {
  let direct: Response | null = null;
  try {
    direct = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), "xi-api-key": key } });
  } catch {
    direct = null; // blocked by the browser or the network: try our pass-through below
  }
  if (direct) {
    if (direct.ok) return direct;
    throw new Error(elevenError(direct.status, await direct.text().catch(() => "")));
  }
  const r = await fetch("/api/elevenlabs", { method: "POST", headers: { "Content-Type": "application/json", "x-eleven-key": key }, body: JSON.stringify(viaUs) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "We couldn't reach ElevenLabs. Please try again.");
  return r;
}

/** Checks the key with ElevenLabs and gets the user's voices. Free: it uses no ElevenLabs characters. */
export async function fetchVoices(key: string): Promise<ElevenVoice[]> {
  const r = await call(key, "/voices", { cache: "no-store" }, { op: "voices" });
  const data = await r.json();
  return Array.isArray(data?.voices) && data.voices[0]?.id ? (data.voices as ElevenVoice[]) : parseVoices(data);
}

/**
 * Reads one voiceover line in the user's own voice (billed to their ElevenLabs
 * account) and stores the sound where our ad mixer can use it.
 */
export async function speakOwn(conn: ElevenConnection, voice: string, text: string, language?: string): Promise<string> {
  const s = checkPrompt(text);
  if (!s.ok) throw new Error("This voiceover line can't be used.");
  const id = ownVoiceId(voice);
  const r = await call(
    conn.key,
    `/text-to-speech/${id}?output_format=mp3_44100_128`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ttsBody(text, language)) },
    { op: "speak", voiceId: id, text, language },
  );
  const audio = await r.blob();
  const up = await fetch("/api/voice-upload", { method: "POST", headers: { "Content-Type": "audio/mpeg" }, body: audio });
  const data = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(data.error ?? "Couldn't save the voiceover. Please try again.");
  return String(data.url ?? "");
}
