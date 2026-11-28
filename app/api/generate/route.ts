import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { getModel, isFalMediaUrl, REFERENCE_IMAGE_MODEL, type AspectRatio } from "@/lib/models";
import { makeDemoMedia } from "@/lib/demo";
import { fal } from "@/lib/fal";
import { checkPrompt, checkWithPersonPhoto } from "@/lib/safety";
import { isRefKind, lockInstructions, MAX_REFS, referenceInstructions, refName, sceneInstructions, verify, type RefKind } from "@/lib/references";
import { enhancePrompt } from "@/lib/enhance";
import { lessonKind } from "@/lib/learn";
import { lessonsFor } from "@/lib/learnStore";
import { payForStep } from "@/lib/accounts/current";
import { generateUsd } from "@/lib/accounts/credits";
import { SCENE_AVOID } from "@/lib/adplan";
import { submitWithBackups } from "@/lib/backups";

export const dynamic = "force-dynamic";

const MAX_PROMPT = 2000;

export async function POST(req: Request) {
  let body: { modelId?: string; prompt?: string; aspectRatio?: string; duration?: number; sourceUrl?: string; sound?: boolean; enhance?: boolean; purpose?: string; scale?: number; refs?: { url?: string; kind?: string; token?: string; name?: string }[]; productUrl?: string; productToken?: string; lessons?: boolean; sameScene?: boolean; noText?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  let model = body.modelId ? getModel(body.modelId) : undefined;
  if (!model) return NextResponse.json({ error: "Unknown model." }, { status: 400 });

  // The user's own reference pictures (product, logo, person). Only for new pictures.
  const rawRefs = Array.isArray(body.refs) ? body.refs.slice(0, MAX_REFS + 1) : [];
  if (rawRefs.length > MAX_REFS) return NextResponse.json({ error: `Use up to ${MAX_REFS} reference pictures.` }, { status: 400 });
  const refs = rawRefs.map((r) => ({ url: String(r?.url ?? ""), kind: r?.kind, token: String(r?.token ?? ""), name: r?.kind === "person" || r?.kind === "character" ? refName(r?.name) : undefined }));
  if (refs.some((r) => !isRefKind(r.kind))) return NextResponse.json({ error: "Bad reference picture." }, { status: 400 });
  const refKinds = refs.map((r) => r.kind as RefKind);
  // A product picture ToastyFly made earlier (signed when it finished), reused so every scene of an ad shows the same product.
  const productUrl = body.productUrl ? String(body.productUrl) : "";
  if (refs.length > 0 || productUrl) {
    if (model.kind !== "image" || model.needsSource)
      return NextResponse.json({ error: "Reference pictures are used to make a picture first." }, { status: 400 });
    model = REFERENCE_IMAGE_MODEL;
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Please describe what you want to create." }, { status: 400 });
  if (prompt.length > MAX_PROMPT)
    return NextResponse.json({ error: `Prompt is too long (max ${MAX_PROMPT} characters).` }, { status: 400 });

  const safety = checkPrompt(prompt);
  if (!safety.ok) return NextResponse.json({ error: safety.reason, blocked: true }, { status: 422 });
  if (refKinds.includes("person")) {
    const personSafety = checkWithPersonPhoto(prompt);
    if (!personSafety.ok) return NextResponse.json({ error: personSafety.reason, blocked: true }, { status: 422 });
  }

  const usesSource = Boolean(model.needsSource || model.takesImage);
  const sourceUrl = usesSource ? String(body.sourceUrl ?? "") : undefined;
  if (usesSource && !sourceUrl) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const aspectRatio = (model.aspectRatios.includes(body.aspectRatio as AspectRatio)
    ? body.aspectRatio
    : model.aspectRatios[0]) as AspectRatio;
  const duration = model.kind === "image"
    ? undefined
    : model.needsSource
    ? Math.min(Math.max(Number(body.duration) || 8, 1), 30)
    : model.durations && model.durations.includes(Number(body.duration))
      ? Number(body.duration)
      : model.durations?.[0];

  const mode = getMode();

  if (mode === "locked") {
    return NextResponse.json(
      { error: "Real generation is switched off until an APP_PASSWORD is set. See the README." },
      { status: 403 },
    );
  }

  // Quietly improve the prompt for this model, then check the new prompt too.
  let finalPrompt = prompt;
  let enhancedPrompt: string | undefined;
  let enhanceNote: string | undefined;
  let avoid: string | undefined;
  let lessonIds: string[] | undefined;
  if (body.enhance !== false && !model.needsSource) {
    const purpose =
      body.purpose === "refix" ? "refix" : body.purpose === "keyframe" ? "keyframe" : model.takesImage ? "animate" : "direct";
    // Rules learned from past fixes. "lessons: false" leaves them out, for side-by-side tests.
    const lk = lessonKind(model.kind);
    const lessons = body.lessons === false || !lk ? [] : await lessonsFor(lk);
    const e = await enhancePrompt(prompt, model, { live: mode === "live", sound: body.sound !== false, purpose, refKinds, seconds: duration, lessons });
    if (e.by !== "none" && checkPrompt(e.prompt).ok && (!refKinds.includes("person") || checkWithPersonPhoto(e.prompt).ok)) {
      finalPrompt = e.prompt;
      enhancedPrompt = e.prompt;
      enhanceNote = e.note;
      avoid = e.avoid && checkPrompt(e.avoid).ok ? e.avoid : undefined;
      if (lessons.length) lessonIds = lessons.map((l) => l.id);
    }
  }

  if (mode === "demo") {
    // Pretend to work for a moment so the app feels like the real thing.
    await new Promise((r) => setTimeout(r, model.kind === "video" ? 2500 : 1200));
    return NextResponse.json({
      status: "COMPLETED",
      demo: true,
      url: makeDemoMedia({ prompt, kind: model.kind, aspectRatio, modelName: model.name }),
      resultToken: "demo",
      aspectRatio,
      duration,
      enhancedPrompt,
      enhanceNote,
      lessons: lessonIds,
    });
  }

  if (sourceUrl && !isFalMediaUrl(sourceUrl)) {
    return NextResponse.json({ error: "Only results made in ToastyFly can be changed." }, { status: 400 });
  }
  // Each reference must be one our safety check passed (signed by /api/reference).
  if (refs.some((r) => !isFalMediaUrl(r.url) || !verify(r.token, "ref", r.url, r.kind as string)))
    return NextResponse.json({ error: "Please upload your reference pictures again." }, { status: 400 });
  if (productUrl && (!isFalMediaUrl(productUrl) || !verify(String(body.productToken ?? ""), "result", productUrl)))
    return NextResponse.json({ error: "That product picture can't be used." }, { status: 400 });
  const refUrls = [...(productUrl ? [productUrl] : []), ...refs.map((r) => r.url)];
  // "lock": the product picture is a video frame to correct, and the user's pictures follow it.
  const refNames = refs.map((r) => r.name);
  if (body.purpose === "lock" && productUrl && refs.length > 0) finalPrompt = `${lockInstructions(refKinds)}\n${finalPrompt}`;
  else if (body.sameScene === true && productUrl) finalPrompt = `${sceneInstructions(refKinds, refNames)}\n${finalPrompt}`;
  else if (refs.length > 0) finalPrompt = `${referenceInstructions(refKinds, productUrl ? 1 : 0, refNames)}\n${finalPrompt}`;

  // Ad scenes carry no writing unless the person asked for it: the video model is told to leave it out.
  if (body.noText === true && model.kind === "video") avoid = [avoid, SCENE_AVOID].filter(Boolean).join(", ").slice(0, 400);

  // With accounts on, the credits for this step come off the person's balance first.
  const pay = await payForStep(req, generateUsd(model, duration, body.sound !== false), duration ? `${model.name}, ${duration}s` : model.name);
  if (pay.error) return pay.error;

  try {
    // If this model is gone or down, a similar one quietly takes the job (lib/backups.ts).
    const sent = await submitWithBackups((id, args) => fal.queue.submit(id, args), model, { prompt: finalPrompt, aspectRatio, duration, sourceUrl, sound: body.sound !== false, refUrls, avoid, scale: Number(body.scale) || undefined });
    await pay.done(sent.requestId);
    return NextResponse.json({ status: "IN_QUEUE", requestId: sent.requestId, modelId: sent.model.id, aspectRatio, duration, enhancedPrompt, enhanceNote, lessons: lessonIds, credits: pay.credits || undefined });
  } catch (err) {
    await pay.undo();
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
