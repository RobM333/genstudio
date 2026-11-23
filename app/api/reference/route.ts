import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { fal } from "@/lib/fal";
import { IMAGE_ANALYZER } from "@/lib/analyze";
import { isFalMediaUrl } from "@/lib/models";
import { safeFetch } from "@/lib/safefetch";
import { isRefKind, judgeRefCheck, MAX_REF_BYTES, refCheckInstructions, sign, verify } from "@/lib/references";

export const dynamic = "force-dynamic";

// POST uploads one reference picture and starts the safety check.
// GET polls the check; when it passes it returns a signed token that
// /api/generate requires before it will use the picture.

function sniffImageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp";
  return null;
}

export async function POST(req: Request) {
  let kind: unknown, consent: unknown, bytes: Uint8Array<ArrayBuffer>;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    // A picture from the user's own product page, fetched here.
    let body: { imageUrl?: string; kind?: string; consent?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    kind = body.kind;
    consent = body.consent;
    if (consent !== "yes") return NextResponse.json({ error: "Please confirm this is your product and you may use its pictures." }, { status: 400 });
    try {
      bytes = (await safeFetch(String(body.imageUrl ?? ""), { maxBytes: MAX_REF_BYTES, accept: "image/png,image/jpeg,image/webp" })).bytes;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message === "That file is too big." ? "That picture is too big. Please use one under 4 MB." : "We couldn't get that picture." }, { status: 400 });
    }
  } else {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    kind = form.get("kind");
    consent = form.get("consent");
    const file = form.get("file");
    if (consent !== "yes")
      return NextResponse.json({ error: "Please confirm you own this picture or have permission from the person shown." }, { status: 400 });
    if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "No picture received." }, { status: 400 });
    if (file.size > MAX_REF_BYTES) return NextResponse.json({ error: "That picture is too big. Please use one under 4 MB." }, { status: 413 });
    bytes = new Uint8Array(await file.arrayBuffer());
  }
  if (!isRefKind(kind)) return NextResponse.json({ error: "Pick what this picture is." }, { status: 400 });

  const type = sniffImageType(bytes);
  if (!type) return NextResponse.json({ error: "Please upload a PNG, JPG or WebP picture." }, { status: 400 });

  const mode = getMode();
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  if (mode === "demo") {
    // No storage in demo mode: keep the picture in the browser only.
    const url = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
    return NextResponse.json({ status: "COMPLETED", demo: true, url, token: "demo" });
  }

  try {
    const url = await fal.storage.upload(new Blob([bytes], { type }));
    const { request_id } = await fal.queue.submit(IMAGE_ANALYZER, {
      input: { model: "google/gemini-2.5-flash", prompt: refCheckInstructions(kind), image_urls: [url] },
    });
    // Ties this check to this exact picture, so a passing check can't be reused for another one.
    const checkToken = sign("check", request_id, url, kind);
    return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, url, checkToken });
  } catch (err) {
    console.error("reference upload failed", err);
    return NextResponse.json({ error: "Couldn't upload the picture. Please try again." }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const requestId = u.searchParams.get("requestId") ?? "";
  const url = u.searchParams.get("url") ?? "";
  const kind = u.searchParams.get("kind");
  const checkToken = u.searchParams.get("checkToken") ?? "";
  if (!/^[\w-]{8,100}$/.test(requestId) || !isRefKind(kind) || !isFalMediaUrl(url) || !verify(checkToken, "check", requestId, url, kind))
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (getMode() !== "live") return NextResponse.json({ error: "Real generation is not switched on." }, { status: 403 });

  try {
    const status = await fal.queue.status(IMAGE_ANALYZER, { requestId });
    if (status.status !== "COMPLETED") return NextResponse.json({ status: status.status });
    const result = await fal.queue.result(IMAGE_ANALYZER, { requestId });
    const out = (result.data as { output?: string })?.output ?? "";
    const verdict = judgeRefCheck(out, kind);
    if (!verdict.ok) return NextResponse.json({ status: "REJECTED", error: verdict.reason });
    return NextResponse.json({ status: "COMPLETED", url, token: sign("ref", url, kind) });
  } catch (err) {
    console.error("reference check failed", err);
    return NextResponse.json({ status: "FAILED", error: "We couldn't check this picture. Please try again." });
  }
}
