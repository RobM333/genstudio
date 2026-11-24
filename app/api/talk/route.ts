import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { fal } from "@/lib/fal";
import { checkPrompt } from "@/lib/safety";
import { makeDemoMedia } from "@/lib/demo";
import { isFalMediaUrl } from "@/lib/models";
import { sign, verify } from "@/lib/references";
import {
  checkConsent,
  CODE_MINUTES,
  MAX_TALK_CHARS,
  newCode,
  speechLanguage,
  TALK_MOTION,
  TALK_SPEECH_MODEL_ID,
  TALK_VIDEO_MODEL_ID,
  TRANSCRIBE_MODEL_ID,
  VOICE_CLONE_MODEL_ID,
} from "@/lib/talk";

export const dynamic = "force-dynamic";

// Talking videos in your own voice.
// Setup (once):
//   POST {action:"code"}             a fresh consent code, signed with the time
//   POST form (file, code, ts, ...)  the recording: uploaded, then transcribed to check the consent sentence
//   GET ?step=consent                when the sentence and code are heard from one speaker, the voice copy starts
//   GET ?step=clone                  the finished copy, signed so only copies made here can be used
// Each video:
//   POST {action:"speak"}            reads the words in the copied voice (poll /api/status)
//   POST {action:"video"}            makes the user's own photo say them (poll /api/status)

const MAX_VOICE_BYTES = 5 * 1024 * 1024;

function bad(error = "Bad request.", status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const mode = getMode();
  if (mode === "locked") return bad("Real generation is switched off.", 403);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return recording(req, mode);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad();
  }

  if (body.action === "code") {
    const code = newCode();
    const ts = String(Date.now());
    return NextResponse.json({ code, ts, codeToken: sign("talk-code", code, ts) });
  }

  if (body.action === "speak") {
    const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TALK_CHARS);
    const voiceId = String(body.voiceId ?? "");
    if (!text || !voiceId) return bad();
    if (!checkPrompt(text).ok) return bad("These words can't be used. Please change them and try again.", 422);
    if (mode === "demo") return NextResponse.json({ status: "COMPLETED", demo: true, url: "demo", resultToken: "demo" });
    // Only voices copied here, after the consent check, can be used.
    if (!verify(String(body.voiceToken ?? ""), "voice", voiceId)) return bad("Please set up your voice again.", 403);
    try {
      const { request_id } = await fal.queue.submit(TALK_SPEECH_MODEL_ID, {
        input: {
          text,
          voice_setting: { voice_id: voiceId, speed: 1, vol: 1 },
          language_boost: speechLanguage(String(body.language ?? "")) as "English",
          output_format: "url",
        },
      });
      return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, modelId: TALK_SPEECH_MODEL_ID });
    } catch (err) {
      console.error("talk speak failed", err);
      return bad("Couldn't read the words in your voice. Please try again.", 502);
    }
  }

  if (body.action === "video") {
    const imageUrl = String(body.imageUrl ?? "");
    const audioUrl = String(body.audioUrl ?? "");
    if (mode === "demo") {
      await new Promise((r) => setTimeout(r, 2500));
      const text = String(body.text ?? "Your talking video").slice(0, 200);
      return NextResponse.json({ status: "COMPLETED", demo: true, url: makeDemoMedia({ prompt: text, kind: "video", aspectRatio: "9:16", modelName: "Talking video" }) });
    }
    // The photo must be the user's own checked person picture, and the voice must have been made here.
    if (!isFalMediaUrl(imageUrl) || !verify(String(body.imageToken ?? ""), "ref", imageUrl, "person")) return bad("Please add your photo again.", 403);
    if (!isFalMediaUrl(audioUrl) || !verify(String(body.audioToken ?? ""), "result", audioUrl)) return bad();
    try {
      const { request_id } = await fal.queue.submit(TALK_VIDEO_MODEL_ID, { input: { image_url: imageUrl, audio_url: audioUrl, prompt: TALK_MOTION } });
      return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, modelId: TALK_VIDEO_MODEL_ID });
    } catch (err) {
      console.error("talk video failed", err);
      return bad("Couldn't start the talking video. Please try again.", 502);
    }
  }

  return bad();
}

/** The voice recording: checked for the consent sentence before any copy is made. */
async function recording(req: Request, mode: string) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad();
  }
  const code = String(form.get("code") ?? "");
  const ts = String(form.get("ts") ?? "");
  const file = form.get("file");
  if (form.get("consent") !== "yes") return bad("Please confirm this is your own voice and you agree to us copying it.");
  if (!/^\d{4}$/.test(code) || !verify(String(form.get("codeToken") ?? ""), "talk-code", code, ts)) return bad("Please start the recording again.");
  if (Date.now() - Number(ts) > CODE_MINUTES * 60 * 1000) return bad("Your code ran out. Please start again for a new one.");
  if (!(file instanceof Blob) || file.size === 0) return bad("No recording received.");
  if (file.size > MAX_VOICE_BYTES) return bad("That recording is too long. Please keep it under a minute and a half.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
  if (!isWav) return bad("We couldn't read that recording. Please try again.");

  if (mode === "demo") {
    // No AI service in demo mode: nothing is checked or copied.
    await new Promise((r) => setTimeout(r, 1200));
    return NextResponse.json({ status: "COMPLETED", demo: true, voiceId: "demo", voiceToken: "demo" });
  }

  try {
    const audioUrl = await fal.storage.upload(new Blob([bytes], { type: "audio/wav" }));
    const { request_id } = await fal.queue.submit(TRANSCRIBE_MODEL_ID, { input: { audio_url: audioUrl, diarize: true, tag_audio_events: false } });
    return NextResponse.json({ status: "CHECKING", requestId: request_id, audioUrl, code, checkToken: sign("talk-check", request_id, audioUrl, code) });
  } catch (err) {
    console.error("talk recording failed", err);
    return bad("Couldn't upload the recording. Please try again.", 502);
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const step = u.searchParams.get("step");
  const requestId = u.searchParams.get("requestId") ?? "";
  if (!/^[\w-]{8,100}$/.test(requestId)) return bad();
  if (getMode() !== "live") return bad("Real generation is not switched on.", 403);

  if (step === "consent") {
    const audioUrl = u.searchParams.get("audioUrl") ?? "";
    const code = u.searchParams.get("code") ?? "";
    if (!isFalMediaUrl(audioUrl) || !verify(u.searchParams.get("checkToken") ?? "", "talk-check", requestId, audioUrl, code)) return bad();
    try {
      const status = await fal.queue.status(TRANSCRIBE_MODEL_ID, { requestId });
      if (status.status !== "COMPLETED") return NextResponse.json({ status: "CHECKING" });
      const result = await fal.queue.result(TRANSCRIBE_MODEL_ID, { requestId });
      const data = result.data as { text?: string; words?: { type?: string; speaker_id?: string | null }[] };
      const speakers = new Set((data.words ?? []).filter((w) => w.type === "word" && w.speaker_id).map((w) => w.speaker_id)).size;
      const verdict = checkConsent(String(data.text ?? ""), code, speakers);
      if (!verdict.ok) return NextResponse.json({ status: "REJECTED", error: verdict.reason });
      // The same recording that holds the consent sentence is the one copied.
      const clone = await fal.queue.submit(VOICE_CLONE_MODEL_ID, { input: { audio_url: audioUrl, noise_reduction: true, need_volume_normalization: true } });
      return NextResponse.json({ status: "COPYING", requestId: clone.request_id, cloneToken: sign("talk-clone", clone.request_id) });
    } catch (err) {
      console.error("talk consent check failed", err);
      return NextResponse.json({ status: "FAILED", error: "We couldn't check the recording. Please try again. It won't use any of your credits." });
    }
  }

  if (step === "clone") {
    if (!verify(u.searchParams.get("cloneToken") ?? "", "talk-clone", requestId)) return bad();
    try {
      const status = await fal.queue.status(VOICE_CLONE_MODEL_ID, { requestId });
      if (status.status !== "COMPLETED") return NextResponse.json({ status: "COPYING" });
      const result = await fal.queue.result(VOICE_CLONE_MODEL_ID, { requestId });
      const voiceId = String((result.data as { custom_voice_id?: string })?.custom_voice_id ?? "");
      if (!voiceId) return NextResponse.json({ status: "FAILED", error: "The voice copy didn't work. Please try a clearer recording." });
      return NextResponse.json({ status: "COMPLETED", voiceId, voiceToken: sign("voice", voiceId) });
    } catch (err) {
      console.error("talk clone failed", err);
      return NextResponse.json({ status: "FAILED", error: "The voice copy didn't work. Please try a clearer recording in a quiet room." });
    }
  }

  return bad();
}
