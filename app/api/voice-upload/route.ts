import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { fal } from "@/lib/fal";
import { isMp3, MAX_VOICE_BYTES } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

// Takes one voiceover line the user's own ElevenLabs voice has read (an MP3 made
// in their browser) and stores it where the ad mixer can use it. No key comes here.
export async function POST(req: Request) {
  const mode = getMode();
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  if (mode === "demo") return NextResponse.json({ status: "COMPLETED", demo: true, url: "" });
  const bytes = new Uint8Array(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.length === 0 || bytes.length > MAX_VOICE_BYTES || !isMp3(bytes)) return NextResponse.json({ error: "That voiceover file couldn't be used." }, { status: 400 });
  try {
    const url = await fal.storage.upload(new Blob([bytes], { type: "audio/mpeg" }));
    return NextResponse.json({ status: "COMPLETED", url });
  } catch (err) {
    console.error("voice upload failed", err);
    return NextResponse.json({ error: "Couldn't save the voiceover. Please try again." }, { status: 502 });
  }
}
