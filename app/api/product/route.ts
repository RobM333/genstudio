import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import { safeFetch } from "@/lib/safefetch";
import { productBrief, readProductPage } from "@/lib/productpage";

export const dynamic = "force-dynamic";

// Reads a product page the user pasted and returns its name, description,
// price and pictures, to start a full ad from. Free: no AI is used.
export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (getMode() === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  const raw = String(body.url ?? "").trim().slice(0, 1000);
  if (!raw) return NextResponse.json({ error: "Paste a link to your product page." }, { status: 400 });
  try {
    const page = await safeFetch(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`, { maxBytes: 1_500_000, accept: "text/html,application/xhtml+xml" });
    if (!/html|xml/i.test(page.type)) return NextResponse.json({ error: "That link isn't a web page." }, { status: 400 });
    const info = readProductPage(new TextDecoder().decode(page.bytes), page.url);
    if (!info.name && !info.description) return NextResponse.json({ error: "We couldn't read a product on that page. Type the details instead." }, { status: 422 });
    const brief = productBrief(info);
    const safe = checkPrompt(brief);
    if (!safe.ok) return NextResponse.json({ error: safe.reason }, { status: 422 });
    return NextResponse.json({ product: info, brief });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "That page couldn't be opened." }, { status: 400 });
  }
}
