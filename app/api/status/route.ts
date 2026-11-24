import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { extractMediaUrl, getModel } from "@/lib/models";
import { fal } from "@/lib/fal";
import { sign } from "@/lib/references";
import { stepFailed } from "@/lib/accounts/current";

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
    if (!mediaUrl) {
      await stepFailed(req, requestId, "no result came back");
      return NextResponse.json({ status: "FAILED", error: "The model returned no result. It won't use any of your credits." });
    }
    // The signature proves this result was made here, so it can be reused safely (for example an ad's product picture).
    return NextResponse.json({ status: "COMPLETED", url: mediaUrl, resultToken: sign("result", mediaUrl) });
  } catch (err) {
    console.error("fal status failed", err);
    await stepFailed(req, requestId);
    return NextResponse.json({ status: "FAILED", error: jobError(err) });
  }
}

/**
 * Turns fal's error into a plain reason the user can act on. Under our promise a
 * failed job never uses the person's credits. (fal doesn't bill server errors;
 * it may bill some refused or invalid requests, a 422, which we absorb.)
 */
function jobError(err: unknown): string {
  const e = err as { status?: number; body?: { detail?: unknown } };
  const detail = typeof e?.body?.detail === "string" ? e.body.detail : JSON.stringify(e?.body?.detail ?? "");
  if (/content checker|content policy|flagged|sensitive|nsfw|safety/i.test(detail)) {
    return "The AI service's content checker refused this. Common causes: a real person's name or look-alike, real team logos, or (for Google Veo) a child in the picture. Try describing people generically, or animate with Kling or Hailuo. It won't use any of your credits.";
  }
  if (e?.status === 422) return "The AI service couldn't use these settings or this prompt. Try a simpler prompt or another model. It won't use any of your credits.";
  return "The job failed on the AI service. Please try again. It won't use any of your credits.";
}
