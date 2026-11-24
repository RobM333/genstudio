import { NextResponse } from "next/server";
import { catalogue, PROBLEM_CODES, summarize, type CustomRule, type LessonKind, type ProblemCode } from "@/lib/learn";
import { getSettings, listEvents, saveSettings } from "@/lib/learnStore";
import { checkPrompt } from "@/lib/safety";

// The owner's page for "learn from every fix" (/learn): what keeps going wrong,
// the rules waiting for an OK, and the on/off switches. Behind the app password
// like the rest of the app, and refuses changes when no password is set, so
// strangers can never switch rules on or off. When accounts arrive, this
// becomes owner-only.

export const dynamic = "force-dynamic";

export async function GET() {
  const [events, settings] = await Promise.all([listEvents(), getSettings(true)]);
  return NextResponse.json(summarize(events, settings), { headers: { "Cache-Control": "no-store" } });
}

const KINDS: LessonKind[] = ["image", "video"];

export async function POST(req: Request) {
  if (!process.env.APP_PASSWORD?.trim() && process.env.FAL_KEY?.trim())
    return NextResponse.json({ error: "Set APP_PASSWORD first, so only you can change these." }, { status: 403 });
  let body: { action?: string; id?: string; kind?: string; text?: string; problem?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const settings = await getSettings(true);
  const next = { rules: { ...settings.rules }, custom: [...settings.custom] };
  const at = new Date().toISOString();
  const id = String(body.id ?? "");
  const known = catalogue().some((r) => r.id === id);
  const custom = next.custom.findIndex((c) => c.id === id);

  if (body.action === "on" || body.action === "off") {
    const on = body.action === "on";
    if (known) next.rules[id] = { on, at: on ? at : (next.rules[id]?.at ?? at) };
    else if (custom >= 0) next.custom[custom] = { ...next.custom[custom], on, at: on ? at : next.custom[custom].at };
    else return NextResponse.json({ error: "Unknown rule." }, { status: 400 });
  } else if (body.action === "skip") {
    if (!known) return NextResponse.json({ error: "Unknown rule." }, { status: 400 });
    next.rules[id] = { on: false, at, skipped: true };
  } else if (body.action === "add") {
    const text = String(body.text ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
    const kind = body.kind as LessonKind;
    if (!KINDS.includes(kind)) return NextResponse.json({ error: "Pick pictures or videos." }, { status: 400 });
    if (text.length < 10 || text.length > 300) return NextResponse.json({ error: "Write the rule in 10 to 300 characters." }, { status: 400 });
    const safe = checkPrompt(text);
    if (!safe.ok) return NextResponse.json({ error: safe.reason }, { status: 400 });
    if (next.custom.length >= 20) return NextResponse.json({ error: "Up to 20 of your own rules. Delete one first." }, { status: 400 });
    const problem = PROBLEM_CODES.includes(body.problem as ProblemCode) ? (body.problem as ProblemCode) : undefined;
    const rule: CustomRule = { id: `custom-${Date.now().toString(36)}`, kind, text, on: true, at, problem };
    next.custom.push(rule);
  } else if (body.action === "delete") {
    if (custom < 0) return NextResponse.json({ error: "Unknown rule." }, { status: 400 });
    next.custom.splice(custom, 1);
  } else {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  await saveSettings(next);
  const events = await listEvents();
  return NextResponse.json(summarize(events, next));
}
