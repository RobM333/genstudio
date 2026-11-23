import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { getModel, type AspectRatio } from "@/lib/models";
import { makeDemoMedia } from "@/lib/demo";
import { fal } from "@/lib/fal";

export const dynamic = "force-dynamic";

const MAX_PROMPT = 2000;

export async function POST(req: Request) {
  let body: { modelId?: string; prompt?: string; aspectRatio?: string; duration?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const model = body.modelId ? getModel(body.modelId) : undefined;
  if (!model) return NextResponse.json({ error: "Unknown model." }, { status: 400 });

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Please describe what you want to create." }, { status: 400 });
  if (prompt.length > MAX_PROMPT)
    return NextResponse.json({ error: `Prompt is too long (max ${MAX_PROMPT} characters).` }, { status: 400 });

  const aspectRatio = (model.aspectRatios.includes(body.aspectRatio as AspectRatio)
    ? body.aspectRatio
    : model.aspectRatios[0]) as AspectRatio;
  const duration =
    model.durations && model.durations.includes(Number(body.duration)) ? Number(body.duration) : model.durations?.[0];

  const mode = getMode();

  if (mode === "demo") {
    // Pretend to work for a moment so the app feels like the real thing.
    await new Promise((r) => setTimeout(r, model.kind === "video" ? 2500 : 1200));
    return NextResponse.json({
      status: "COMPLETED",
      demo: true,
      url: makeDemoMedia({ prompt, kind: model.kind, aspectRatio, modelName: model.name }),
      aspectRatio,
      duration,
    });
  }

  if (mode === "locked") {
    return NextResponse.json(
      { error: "Real generation is switched off until an APP_PASSWORD is set. See the README." },
      { status: 403 },
    );
  }

  try {
    const { request_id } = await fal.queue.submit(model.id, {
      input: model.buildInput({ prompt, aspectRatio, duration }),
    });
    return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, aspectRatio, duration });
  } catch (err) {
    console.error("fal submit failed", err);
    return NextResponse.json({ error: friendlyError(err) }, { status: 502 });
  }
}

function friendlyError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return "The fal.ai key was rejected. Check FAL_KEY in your settings.";
  if (status === 402) return "Your fal.ai account is out of credit.";
  if (status === 422) return "The model didn't accept these settings. Try a different prompt or option.";
  return "The AI service had a problem. Please try again.";
}
