import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { payForStep } from "@/lib/accounts/current";
import { MAX_CLIP_BYTES, MAX_RECORDING_BYTES } from "@/lib/script";

export const dynamic = "force-dynamic";

// Script to Video: the person's own video clips and their own recording of the
// script are too big to pass through our server, so the server asks fal.ai for
// a one-time upload address and the browser sends the file straight there.
// The fal key never leaves the server. Uploading is free.

const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/wav", "audio/x-wav", "audio/wave", "audio/webm", "audio/ogg"];

export async function POST(req: Request) {
  let body: { kind?: string; type?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const mode = getMode();
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  const clip = body.kind === "clip";
  const type = String(body.type ?? "").toLowerCase();
  const size = Number(body.size) || 0;
  if (!(clip ? VIDEO_TYPES : AUDIO_TYPES).includes(type)) return NextResponse.json({ error: clip ? "Please use an MP4, MOV or WebM video." : "Please use an MP3, M4A, WAV or WebM recording." }, { status: 400 });
  const max = clip ? MAX_CLIP_BYTES : MAX_RECORDING_BYTES;
  if (size <= 0 || size > max) return NextResponse.json({ error: `That file is too big. Please keep it under ${Math.round(max / 1024 / 1024)} MB.` }, { status: 400 });
  if (mode === "demo") return NextResponse.json({ demo: true });
  // Signed-in people only (when accounts are on), so strangers can't fill our storage.
  const pay = await payForStep(req, 0, "Upload");
  if (pay.error) return pay.error;
  try {
    const res = await fetch("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
      method: "POST",
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: type, file_name: `${clip ? "clip" : "recording"}-${Date.now()}.${extFor(type)}` }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as { upload_url?: string; file_url?: string };
    if (!res.ok || !data.upload_url || !data.file_url) throw new Error(`initiate ${res.status}`);
    return NextResponse.json({ uploadUrl: data.upload_url, fileUrl: data.file_url });
  } catch (err) {
    console.error("upload initiate failed", err);
    return NextResponse.json({ error: "We couldn't start the upload. Please try again." }, { status: 502 });
  }
}

function extFor(type: string): string {
  if (type.includes("quicktime")) return "mov";
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4") && type.startsWith("video")) return "mp4";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("wav") || type.includes("wave")) return "wav";
  if (type.includes("ogg")) return "ogg";
  return "mp3";
}
