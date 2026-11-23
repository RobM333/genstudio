import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { fal } from "@/lib/fal";
import { isFalMediaUrl, LAST_FRAME_MODEL, MERGE_VIDEOS_MODEL } from "@/lib/models";

export const dynamic = "force-dynamic";

// Small video helpers for storyboards: grab a video's last frame, or join
// several videos into one. Both cost almost nothing on fal. Poll /api/status.
export async function POST(req: Request) {
  let body: { tool?: string; urls?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const urls = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 7) : [];
  const tool = body.tool === "merge" ? MERGE_VIDEOS_MODEL : body.tool === "last-frame" ? LAST_FRAME_MODEL : null;
  if (!tool || urls.length === 0 || (tool === LAST_FRAME_MODEL && urls.length !== 1))
    return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const mode = getMode();
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  if (mode === "demo") return NextResponse.json({ status: "COMPLETED", demo: true, url: urls[urls.length - 1] });
  if (!urls.every(isFalMediaUrl)) return NextResponse.json({ error: "Only results made in GenStudio can be used." }, { status: 400 });

  try {
    const input =
      tool === LAST_FRAME_MODEL ? { video_url: urls[0], frame_type: "last" } : { video_urls: urls, resolution_aspect_ratio_video_index: 0 };
    const { request_id } = await fal.queue.submit(tool.id, { input });
    return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, modelId: tool.id });
  } catch (err) {
    console.error("tool submit failed", err);
    return NextResponse.json({ error: "The video tool had a problem. Please try again." }, { status: 502 });
  }
}
