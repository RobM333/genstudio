import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { fal } from "@/lib/fal";
import { checkPrompt } from "@/lib/safety";
import { AD_VOICES } from "@/lib/adplan";
import { CARD_MOTION_MODEL, COMPOSE_MODEL, isFalMediaUrl, LAST_FRAME_MODEL, MERGE_VIDEOS_MODEL, MUSIC_MODEL, VOICE_MODEL } from "@/lib/models";

export const dynamic = "force-dynamic";

// Small helpers for storyboards and full ads, each a short fal job (poll /api/status):
// - last-frame: grab a video's last frame so the next shot can continue from it
// - merge: join several videos into one
// - voice: read a voiceover line
// - music: make an instrumental music bed
// - card: turn the ad's end card picture into a short, nearly still video
// - mix: put a video, voiceover clips and music together
type Body = {
  tool?: string;
  urls?: unknown;
  text?: string;
  voice?: string;
  prompt?: string;
  seconds?: number;
  imageUrl?: string;
  videoUrl?: string;
  voices?: { url?: string; at?: number; seconds?: number }[];
  musicUrl?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const mode = getMode();
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  const urls = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 14) : [];
  const seconds = Math.max(1, Math.min(70, Number(body.seconds) || 5));

  let modelId: string;
  let input: Record<string, unknown>;
  let demoUrl = "";
  const allUrls: string[] = [];

  switch (body.tool) {
    case "last-frame":
    case "merge": {
      const tool = body.tool === "merge" ? MERGE_VIDEOS_MODEL : LAST_FRAME_MODEL;
      if (urls.length === 0 || (tool === LAST_FRAME_MODEL && urls.length !== 1)) return bad();
      modelId = tool.id;
      input = tool === LAST_FRAME_MODEL ? { video_url: urls[0], frame_type: "last" } : { video_urls: urls, resolution_aspect_ratio_video_index: 0 };
      allUrls.push(...urls);
      demoUrl = urls[urls.length - 1];
      break;
    }
    case "voice": {
      const text = String(body.text ?? "").trim().slice(0, 400);
      if (!text) return bad();
      if (!checkPrompt(text).ok) return NextResponse.json({ error: "This voiceover line can't be used." }, { status: 422 });
      const voice = AD_VOICES.some((v) => v.id === body.voice) ? String(body.voice) : "Rachel";
      modelId = VOICE_MODEL.id;
      input = { text, voice, stability: 0.5, similarity_boost: 0.75, speed: 1 };
      break;
    }
    case "music": {
      const prompt = String(body.prompt ?? "").trim().slice(0, 300);
      if (!prompt || !checkPrompt(prompt).ok) return bad();
      modelId = MUSIC_MODEL.id;
      input = { prompt: `${prompt}. Instrumental only, no vocals. A subtle background bed for a voiceover, gentle and not too loud.`, duration: Math.ceil(seconds) };
      break;
    }
    case "card": {
      // A picture on its own comes out of the mixer as a single frame, so the end card gets a gentle, nearly still move.
      const imageUrl = String(body.imageUrl ?? "");
      if (!imageUrl) return bad();
      modelId = CARD_MOTION_MODEL.id;
      input = {
        image_url: imageUrl,
        prompt: "A completely still product end card. Very slow, subtle push-in. The text stays perfectly still, sharp and readable. Nothing else moves.",
        negative_prompt: "moving text, warped letters, morphing, distorted, jittery, blurry, new objects",
        num_frames: Math.min(241, Math.round(seconds * 24) + 1),
        resolution: "720p",
        aspect_ratio: "auto",
      };
      allUrls.push(imageUrl);
      demoUrl = imageUrl;
      break;
    }
    case "mix": {
      const videoUrl = String(body.videoUrl ?? "");
      if (!videoUrl) return bad();
      const ms = Math.round(seconds * 1000);
      const voices = (Array.isArray(body.voices) ? body.voices : [])
        .filter((v) => v && typeof v.url === "string" && v.url)
        .slice(0, 14)
        .map((v) => ({ url: String(v.url), timestamp: Math.max(0, Math.round(Number(v.at) * 1000) || 0), duration: Math.max(500, Math.round(Number(v.seconds) * 1000) || 4000) }));
      const tracks: Record<string, unknown>[] = [{ id: "video", type: "video", keyframes: [{ url: videoUrl, timestamp: 0, duration: ms }] }];
      if (voices.length) tracks.push({ id: "voice", type: "audio", keyframes: voices });
      if (body.musicUrl) tracks.push({ id: "music", type: "audio", keyframes: [{ url: String(body.musicUrl), timestamp: 0, duration: ms }] });
      modelId = COMPOSE_MODEL.id;
      input = { tracks };
      allUrls.push(videoUrl, ...voices.map((v) => v.url), ...(body.musicUrl ? [String(body.musicUrl)] : []));
      demoUrl = videoUrl;
      break;
    }
    default:
      return bad();
  }

  // Demo mode has no AI service: pictures and videos pass straight through, sound is skipped.
  if (mode === "demo") return NextResponse.json({ status: "COMPLETED", demo: true, url: demoUrl });
  if (!allUrls.every(isFalMediaUrl)) return NextResponse.json({ error: "Only results made in ToastyFly can be used." }, { status: 400 });

  try {
    const { request_id } = await fal.queue.submit(modelId, { input });
    return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, modelId });
  } catch (err) {
    console.error("tool submit failed", err);
    return NextResponse.json({ error: "The video tool had a problem. Please try again." }, { status: 502 });
  }
}

function bad() {
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
