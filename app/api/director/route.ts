import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import { cleanBrand } from "@/lib/brand";
import { directorInstructions, directorWithRules, parseDirector } from "@/lib/director";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 15000;

// The creative director: three directed ways to make the user's idea, and up
// to two questions. About a tenth of a cent per call. Falls back to rules.
export async function POST(req: Request) {
  let body: { idea?: string; kind?: string; answers?: string; brand?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const kind = body.kind === "image" ? "image" : "video";
  const idea = String(body.idea ?? "").trim().slice(0, 2000);
  const answers = String(body.answers ?? "").trim().slice(0, 600);
  const brand = cleanBrand(body.brand);
  if (!idea) return NextResponse.json({ error: "Write your idea first, even a few words." }, { status: 400 });
  for (const text of [idea, answers, brand?.name ?? "", brand?.style ?? ""]) {
    const s = checkPrompt(text);
    if (text && !s.ok) return NextResponse.json({ error: s.reason, blocked: true }, { status: 422 });
  }

  if (getMode() === "live") {
    try {
      const { fal } = await import("@/lib/fal");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = (await Promise.race([
        fal.run("fal-ai/any-llm", {
          input: {
            model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash",
            system_prompt: directorInstructions(kind, brand),
            prompt: `The idea:\n${idea}${answers ? `\n\nThe user's answers to your questions:\n${answers}\nDon't ask these again.` : ""}`,
          },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("director timed out")), TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer))) as { data?: { output?: string } };
      const reply = parseDirector(result?.data?.output ?? "", kind);
      if (reply && reply.directions.every((d) => checkPrompt(d.prompt).ok)) return NextResponse.json({ ...reply, by: "ai" });
    } catch (err) {
      console.warn("director fell back to rules:", (err as Error)?.message);
    }
  }
  return NextResponse.json({ ...directorWithRules(answers ? `${idea}. ${answers}` : idea, kind, brand), by: "rules" });
}
