import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import { cleanBrand } from "@/lib/brand";
import {
  aboutBusiness,
  adaptInstructions,
  adaptWithRules,
  ideasInstructions,
  ideasWithRules,
  parseAdapt,
  parseIdeas,
  weekInstructions,
  weekWithRules,
} from "@/lib/ideas";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 20000;

type Body = {
  mode?: string; // "ideas" | "week" | "adapt"
  business?: string;
  goal?: string;
  season?: string;
  days?: unknown;
  example?: string;
  kind?: string;
  fields?: unknown;
  brand?: unknown;
};

async function ask(system: string, prompt: string): Promise<string> {
  const { askWriter } = await import("@/lib/fal");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = (await Promise.race([
    askWriter({ model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash", system_prompt: system, prompt }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ideas timed out")), TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer))) as { data?: { output?: string } };
  return result?.data?.output ?? "";
}

// Idea helpers: 5 concepts, a week of posts, or "make one like this for my brand".
// About a tenth of a cent per call. Falls back to simple rules.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const mode = body.mode === "week" || body.mode === "adapt" ? body.mode : "ideas";
  const business = String(body.business ?? "").trim().slice(0, 400);
  const goal = String(body.goal ?? "").trim().slice(0, 300);
  const season = String(body.season ?? "").trim().slice(0, 120);
  const example = String(body.example ?? "").trim().slice(0, 2000);
  const kind = body.kind === "video" ? "video" : "image";
  const days = (Array.isArray(body.days) ? body.days : []).map((d) => String(d).slice(0, 20)).filter(Boolean).slice(0, 7);
  const fields = (Array.isArray(body.fields) ? body.fields : [])
    .map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      return { key: String(o.key ?? "").slice(0, 30), label: String(o.label ?? "").slice(0, 60), placeholder: String(o.placeholder ?? "").slice(0, 120) };
    })
    .filter((f) => /^[a-z0-9_-]+$/i.test(f.key))
    .slice(0, 8);
  const brand = cleanBrand(body.brand);

  if (mode === "ideas" && !business) return NextResponse.json({ error: "Tell us your business first, even a few words." }, { status: 400 });
  if (mode === "week" && days.length !== 7) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (mode === "week" && !business && !brand) return NextResponse.json({ error: "Add what you sell to your brand kit first." }, { status: 400 });
  if (mode === "adapt" && !business && !brand?.name) return NextResponse.json({ error: "Tell us your product or business first." }, { status: 400 });
  if (mode === "adapt" && !example) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  for (const text of [business, goal, brand?.name ?? "", brand?.style ?? ""]) {
    const s = checkPrompt(text);
    if (text && !s.ok) return NextResponse.json({ error: s.reason, blocked: true }, { status: 422 });
  }

  const live = getMode() === "live";
  const safe = (p: string) => checkPrompt(p).ok;

  if (mode === "adapt") {
    if (live) {
      try {
        const raw = await ask(
          adaptInstructions(kind, fields, brand),
          `The example ${kind}:\n${example}\n\nThe user's product or business:\n${business || brand?.name}`,
        );
        const out = parseAdapt(raw, fields);
        const texts = out?.prompt ? [out.prompt] : Object.values(out?.fields ?? {});
        if (out && texts.every(safe)) return NextResponse.json({ ...out, by: "ai" });
      } catch (err) {
        console.warn("adapt fell back to rules:", (err as Error)?.message);
      }
    }
    return NextResponse.json({ ...adaptWithRules(example, business, fields, brand), by: "rules" });
  }

  if (mode === "week") {
    if (live) {
      try {
        const raw = await ask(weekInstructions(days, season || "this week", brand), aboutBusiness(business, brand?.name));
        const ideas = parseIdeas(raw, days);
        if (ideas && ideas.every((i) => safe(i.prompt))) return NextResponse.json({ ideas, by: "ai" });
      } catch (err) {
        console.warn("week plan fell back to rules:", (err as Error)?.message);
      }
    }
    return NextResponse.json({ ideas: weekWithRules(days, business, brand), by: "rules" });
  }

  if (live) {
    try {
      const raw = await ask(ideasInstructions(brand), `The business:\n${business}${goal ? `\n\nWhat they want to achieve:\n${goal}` : ""}`);
      const ideas = parseIdeas(raw);
      if (ideas && ideas.every((i) => safe(i.prompt))) return NextResponse.json({ ideas, by: "ai" });
    } catch (err) {
      console.warn("ideas fell back to rules:", (err as Error)?.message);
    }
  }
  return NextResponse.json({ ideas: ideasWithRules(business, goal, brand), by: "rules" });
}
