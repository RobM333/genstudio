import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import { PLAN_BATCH, parseScriptBatch, ruleSearch, ruleVisual, scriptPlanInstructions } from "@/lib/script";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 22000;

// Script to Video: plans one shot for each line of a batch of up to 30 lines of
// the person's script. The words are never changed, only the shots are planned.
// About a fifth of a cent per batch. Falls back to rules.
export async function POST(req: Request) {
  let body: { lines?: unknown; first?: boolean; look?: string; brand?: string; star?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => String(l ?? "").replace(/\s+/g, " ").trim().slice(0, 400)).filter(Boolean).slice(0, PLAN_BATCH);
  if (!lines.length) return NextResponse.json({ error: "Paste your script first." }, { status: 400 });
  for (const text of lines) {
    const s = checkPrompt(text);
    if (!s.ok) return NextResponse.json({ error: `This line can't be used: "${text.slice(0, 80)}". ${s.reason ?? ""}`.trim(), blocked: true }, { status: 422 });
  }
  const look = String(body.look ?? "").slice(0, 400);
  const brand = String(body.brand ?? "").slice(0, 400);
  const star = String(body.star ?? "").slice(0, 200);
  const rules = () => ({ title: "", look: "", music: "", beats: lines.map((text) => ({ text, visual: ruleVisual(text), search: ruleSearch(text) })) });

  if (getMode() !== "live") return NextResponse.json({ ...rules(), by: "rules" });
  try {
    const { fal } = await import("@/lib/fal");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = (await Promise.race([
      fal.run("fal-ai/any-llm", {
        input: {
          model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash",
          system_prompt: scriptPlanInstructions({ count: lines.length, first: Boolean(body.first), look, brand, star }),
          prompt: lines.map((l, i) => `${i + 1}. ${l}`).join("\n"),
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("script planner timed out")), TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer))) as { data?: { output?: string } };
    const out = parseScriptBatch(result?.data?.output ?? "", lines);
    // A planned shot that trips the safety check goes back to the plain rule shot.
    out.beats = out.beats.map((b) => (checkPrompt(`${b.visual} ${b.search}`).ok ? b : { ...b, visual: ruleVisual(b.text), search: ruleSearch(b.text), key: undefined }));
    if (!checkPrompt(`${out.look} ${out.music} ${out.title}`).ok) Object.assign(out, { look: "", music: "", title: "" });
    return NextResponse.json({ ...out, by: "ai" });
  } catch (err) {
    console.warn("script planner fell back:", (err as Error)?.message);
    return NextResponse.json({ ...rules(), by: "rules" });
  }
}
