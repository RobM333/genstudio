import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import { parsePlan, planInstructions, planWithRules, MAX_STORY_SECONDS } from "@/lib/storyboard";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 7000;

// Plans a video idea into short shots (about $0.001). Falls back to simple rules.
export async function POST(req: Request) {
  let body: { prompt?: string; targetSeconds?: number; shotSeconds?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const prompt = String(body.prompt ?? "").trim().slice(0, 2000);
  if (!prompt) return NextResponse.json({ error: "Describe your video first." }, { status: 400 });
  const safety = checkPrompt(prompt);
  if (!safety.ok) return NextResponse.json({ error: safety.reason, blocked: true }, { status: 422 });
  const shotSeconds = [5, 6, 8, 10].includes(Number(body.shotSeconds)) ? Number(body.shotSeconds) : 5;
  const target = Number(body.targetSeconds);
  const targetSeconds = target >= 5 && target <= MAX_STORY_SECONDS ? target : undefined;

  if (getMode() === "live") {
    try {
      const { fal } = await import("@/lib/fal");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = (await Promise.race([
        fal.run("openrouter/router", {
          input: {
            model: process.env.ENHANCER_MODEL || "google/gemini-2.5-flash",
            system_prompt: planInstructions(targetSeconds),
            prompt: `User's idea:\n${prompt}`,
          },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("planner timed out")), TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer))) as { data?: { output?: string } };
      const plan = parsePlan(result?.data?.output ?? "", shotSeconds);
      if (plan && plan.shots.every((s) => checkPrompt(s.prompt).ok)) return NextResponse.json({ plan, by: "ai" });
    } catch (err) {
      console.warn("shot planner fell back to rules:", (err as Error)?.message);
    }
  }
  return NextResponse.json({ plan: planWithRules(prompt, shotSeconds, targetSeconds), by: "rules" });
}
