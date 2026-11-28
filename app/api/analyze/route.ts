import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { isFalMediaUrl } from "@/lib/models";
import { checkPrompt } from "@/lib/safety";
import { analysisInstructions, IMAGE_ANALYZER, parseAnalysis, SPEECH_CHECKER, VIDEO_ANALYZER } from "@/lib/analyze";
import { isRealSpeech } from "@/lib/promise";
import { fal, submitCheck } from "@/lib/fal";

export const dynamic = "force-dynamic";

// POST starts an analysis and returns a job id; GET checks on it. Split like
// this so slow video analysis never hits the hosting time limit.
export async function POST(req: Request) {
  let body: { kind?: string; url?: string; prompt?: string; productUrl?: string; productNote?: string; auto?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const url = String(body.url ?? "");
  if (body.kind === "speech") return startSpeechCheck(url);
  const kind = body.kind === "video" ? "video" : "image";
  const prompt = String(body.prompt ?? "").trim().slice(0, 2000);
  if (!url || !prompt) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const safety = checkPrompt(prompt);
  if (!safety.ok) return NextResponse.json({ error: safety.reason, blocked: true }, { status: 422 });

  const mode = getMode();
  if (mode === "demo") {
    await new Promise((r) => setTimeout(r, 1200));
    // The ad builder's automatic check: in demo mode it finds one example problem, so the remake step can be seen.
    if (body.auto)
      return NextResponse.json({
        status: "COMPLETED",
        demo: true,
        analysis: { problems: ["Demo mode: an example problem. The product's label faces away from the camera."], fix: "Turn the product so its label faces the camera.", prompt, serious: true },
      });
    return NextResponse.json({
      status: "COMPLETED",
      demo: true,
      analysis: {
        problems: ["Demo mode: this is an example. The hoop is on the left, but the request puts it on the right.", "The boy faces the camera instead of the court."],
        fix: "Move the hoop to the right side and turn the boy so he faces the court.",
        prompt: `${prompt} Wide shot from behind the crowd, hoop on the right, the boy in the foreground facing the court.`,
      },
    });
  }
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  if (!isFalMediaUrl(url)) return NextResponse.json({ error: "Only results made in ToastyFly can be analyzed." }, { status: 400 });
  // A picture's check can compare the product with its reference picture.
  const productUrl = kind === "image" && body.productUrl && isFalMediaUrl(String(body.productUrl)) ? String(body.productUrl) : "";

  try {
    const productNote = String(body.productNote ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const instructions = analysisInstructions(kind, prompt, Boolean(productUrl), productNote);
    const { request_id } =
      kind === "video"
        ? await fal.queue.submit(VIDEO_ANALYZER, { input: { video_url: url, prompt: instructions } })
        : await submitCheck(IMAGE_ANALYZER, { model: "google/gemini-2.5-flash", prompt: instructions, image_urls: productUrl ? [url, productUrl] : [url] });
    return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, kind });
  } catch (err) {
    console.error("analyze submit failed", err);
    return NextResponse.json({ error: "Couldn't start the analysis. Please try again." }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") === "video" ? "video" : "image";
  const requestId = u.searchParams.get("requestId") ?? "";
  if (!/^[\w-]{8,100}$/.test(requestId)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (getMode() !== "live") return NextResponse.json({ error: "Real generation is not switched on." }, { status: 403 });
  if (u.searchParams.get("kind") === "speech") return speechResult(requestId);
  const endpoint = kind === "video" ? VIDEO_ANALYZER : IMAGE_ANALYZER;
  try {
    const status = await fal.queue.status(endpoint, { requestId });
    if (status.status !== "COMPLETED") return NextResponse.json({ status: status.status });
    const result = await fal.queue.result(endpoint, { requestId });
    const output = String((result.data as { output?: string })?.output ?? "");
    const analysis = parseAnalysis(output);
    if (!analysis) return NextResponse.json({ status: "FAILED", error: "The analysis didn't come back in a usable form. Try again." });
    return NextResponse.json({ status: "COMPLETED", analysis });
  } catch (err) {
    console.error("analyze status failed", err);
    return NextResponse.json({ status: "FAILED", error: "The analysis failed. Please try again." });
  }
}

/**
 * Listens to a finished video for a voice saying words. Used when the person
 * didn't ask for speech, because talking they didn't ask for is a clear fault.
 */
async function startSpeechCheck(url: string) {
  const mode = getMode();
  if (mode === "demo") return NextResponse.json({ status: "COMPLETED", demo: true, speech: false });
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  if (!isFalMediaUrl(url)) return NextResponse.json({ error: "Only results made in ToastyFly can be checked." }, { status: 400 });
  try {
    const { request_id } = await fal.queue.submit(SPEECH_CHECKER, { input: { audio_url: url, task: "transcribe", chunk_level: "segment" } });
    return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, kind: "speech" });
  } catch (err) {
    console.error("speech check submit failed", err);
    return NextResponse.json({ error: "Couldn't start the sound check." }, { status: 502 });
  }
}

async function speechResult(requestId: string) {
  try {
    const status = await fal.queue.status(SPEECH_CHECKER, { requestId });
    if (status.status !== "COMPLETED") return NextResponse.json({ status: status.status });
    const result = await fal.queue.result(SPEECH_CHECKER, { requestId });
    const text = String((result.data as { text?: string })?.text ?? "").slice(0, 500);
    return NextResponse.json({ status: "COMPLETED", speech: isRealSpeech(text), transcript: text });
  } catch (err) {
    // A video with no sound track can't be transcribed: that simply means nobody talks.
    console.error("speech check failed", err);
    return NextResponse.json({ status: "COMPLETED", speech: false });
  }
}
