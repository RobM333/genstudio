import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { extractMediaUrl, getModel } from "@/lib/models";
import { fal } from "@/lib/fal";

export const dynamic = "force-dynamic";

// The browser calls this every few seconds while a job is running.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const model = getModel(url.searchParams.get("modelId") ?? "");
  const requestId = url.searchParams.get("requestId") ?? "";

  if (!model || !/^[\w-]{8,100}$/.test(requestId))
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (getMode() !== "live") return NextResponse.json({ error: "Real generation is not switched on." }, { status: 403 });

  try {
    const status = await fal.queue.status(model.id, { requestId });
    if (status.status !== "COMPLETED") {
      return NextResponse.json({
        status: status.status,
        queuePosition: status.status === "IN_QUEUE" ? status.queue_position : undefined,
      });
    }
    const result = await fal.queue.result(model.id, { requestId });
    const mediaUrl = extractMediaUrl(result.data);
    if (!mediaUrl) return NextResponse.json({ status: "FAILED", error: "The model returned no result." });
    return NextResponse.json({ status: "COMPLETED", url: mediaUrl });
  } catch (err) {
    console.error("fal status failed", err);
    return NextResponse.json({ status: "FAILED", error: jobError(err) });
  }
}

/** Turns fal's error into a plain reason the user can act on. Failed jobs are not charged. */
function jobError(err: unknown): string {
  const e = err as { status?: number; body?: { detail?: unknown } };
  const detail = typeof e?.body?.detail === "string" ? e.body.detail : JSON.stringify(e?.body?.detail ?? "");
  if (/content checker|content policy|flagged|sensitive|nsfw|safety/i.test(detail)) {
    return "The AI service's content checker refused this. Real people's names (like celebrities) are the most common cause: describe the person instead, e.g. \"a legendary basketball player\". You weren't charged.";
  }
  if (e?.status === 422) return "The AI service couldn't use these settings or this prompt. Try a simpler prompt or another model. You weren't charged.";
  return "The job failed on the AI service. Please try again. You weren't charged.";
}
