import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import { cleanBrand } from "@/lib/brand";
import { adLanguage, AD_LENGTHS, AD_TONES, adPlanInstructions, adPlanWithRules, parseAdPlan, planTexts, revisePlanInstructions, type AdBrief, type AdPlan } from "@/lib/adplan";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 20000;

// Plans a full ad (concept and scenes), or applies a change the user asked for
// to an existing plan. About a tenth of a cent per call. Falls back to rules.
export async function POST(req: Request) {
  let body: { brief?: Partial<AdBrief>; plan?: AdPlan; request?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const b = body.brief ?? {};
  const brief: AdBrief = {
    product: String(b.product ?? "").trim().slice(0, 600),
    audience: String(b.audience ?? "").trim().slice(0, 300),
    seconds: AD_LENGTHS.includes(Number(b.seconds) as 15) ? Number(b.seconds) : 15,
    tone: (AD_TONES as readonly string[]).includes(String(b.tone)) ? String(b.tone) : "Friendly",
    refKinds: Array.isArray(b.refKinds) ? b.refKinds.map(String).filter((k) => ["product", "logo", "person", "style"].includes(k)).slice(0, 4) : [],
    brand: cleanBrand(b.brand),
    language: adLanguage(b.language),
  };
  if (!brief.product) return NextResponse.json({ error: "Tell us what you're advertising first." }, { status: 400 });
  const request = String(body.request ?? "").trim().slice(0, 600);
  for (const text of [brief.product, brief.audience, request, brief.brand?.name ?? "", brief.brand?.style ?? ""]) {
    const s = checkPrompt(text);
    if (text && !s.ok) return NextResponse.json({ error: s.reason, blocked: true }, { status: 422 });
  }
  const revising = Boolean(request && body.plan);

  if (getMode() === "live") {
    try {
      const { fal } = await import("@/lib/fal");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const prompt = revising
        ? `Product: ${brief.product}\nAudience: ${brief.audience}\n\nCurrent plan:\n${JSON.stringify(body.plan).slice(0, 6000)}\n\nChange requested by the user:\n${request}`
        : `Product: ${brief.product}\nAudience: ${brief.audience || "not given, pick the most likely buyers"}`;
      const result = (await Promise.race([
        fal.run("fal-ai/any-llm", {
          input: {
            model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash",
            system_prompt: revising ? revisePlanInstructions(brief) : adPlanInstructions(brief),
            prompt,
          },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("ad planner timed out")), TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer))) as { data?: { output?: string } };
      const plan = parseAdPlan(result?.data?.output ?? "", brief);
      if (plan && planTexts(plan).every((t) => checkPrompt(t).ok)) return NextResponse.json({ plan, by: "ai" });
    } catch (err) {
      console.warn("ad planner fell back:", (err as Error)?.message);
    }
  }
  if (revising) return NextResponse.json({ error: "Couldn't change the plan right now. Edit the scene boxes directly, or try again." }, { status: 503 });
  return NextResponse.json({ plan: adPlanWithRules(brief), by: "rules" });
}
