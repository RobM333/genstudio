import { NextResponse } from "next/server";
import { toEvent } from "@/lib/learn";
import { addEvent, scramble } from "@/lib/learnStore";

// "Learn from every fix": the browser tells us when a result was fixed, remade,
// checked or rated, and when a result finished. Free: no AI is called here.
// We keep only the kind of problem, never who sent it (see lib/learn.ts).

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const visitor = typeof body.visitor === "string" && /^[\w-]{8,64}$/.test(body.visitor) ? body.visitor : "";
  if (!visitor) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const event = toEvent(body, scramble(visitor));
  if (!event) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  try {
    const r = await addEvent(event);
    return NextResponse.json({ ok: r === "added", problems: event.problems });
  } catch (err) {
    console.warn("feedback not saved:", (err as Error)?.message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
