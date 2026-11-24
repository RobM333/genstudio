import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import { elevenError, looksLikeKey, parseVoices, ttsBody } from "@/lib/elevenlabs";
import { adLanguage } from "@/lib/adplan";

export const dynamic = "force-dynamic";

// A plain pass-through to ElevenLabs, used only if the user's browser can't
// reach ElevenLabs directly. The user's key arrives in a header, is passed on
// to ElevenLabs for this one request, and is never stored or written to a log.
// It can only list the user's voices or read one voiceover line.

const API = "https://api.elevenlabs.io/v1";
const TIMEOUT_MS = 30000;

export async function POST(req: Request) {
  if (getMode() === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  const key = req.headers.get("x-eleven-key") ?? "";
  if (!looksLikeKey(key)) return NextResponse.json({ error: "That doesn't look like an ElevenLabs key." }, { status: 400 });
  let body: { op?: string; voiceId?: string; text?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const headers = { "xi-api-key": key, "Content-Type": "application/json" };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    if (body.op === "voices") {
      const r = await fetch(`${API}/voices`, { headers, signal, cache: "no-store" });
      if (!r.ok) return NextResponse.json({ error: elevenError(r.status, await r.text().catch(() => "")) }, { status: 502 });
      return NextResponse.json({ voices: parseVoices(await r.json()) });
    }
    if (body.op === "speak") {
      const voiceId = String(body.voiceId ?? "");
      const text = String(body.text ?? "").trim().slice(0, 400);
      if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId) || !text) return NextResponse.json({ error: "Bad request." }, { status: 400 });
      if (!checkPrompt(text).ok) return NextResponse.json({ error: "This voiceover line can't be used." }, { status: 422 });
      const r = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify(ttsBody(text, adLanguage(body.language))),
      });
      if (!r.ok) return NextResponse.json({ error: elevenError(r.status, await r.text().catch(() => "")) }, { status: 502 });
      return new NextResponse(await r.arrayBuffer(), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
  } catch {
    // Deliberately no logging here: the request carried the user's key.
    return NextResponse.json({ error: "We couldn't reach ElevenLabs. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
