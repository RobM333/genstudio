import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { isFalMediaUrl } from "@/lib/models";
import { sign, verify } from "@/lib/references";
import { checkCharacter } from "@/lib/characters";
import { checkPrompt } from "@/lib/safety";

export const dynamic = "force-dynamic";

// Saves a character's look picture as a person reference. The picture must be
// one ToastyFly made (signed when it finished) and the character must pass the
// character rules (an invented adult or someone who agreed, never a real or
// famous person). Then it works anywhere a person reference does.
export async function POST(req: Request) {
  let body: { url?: string; token?: string; name?: string; look?: string; outfit?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const c = { name: String(body.name ?? "").slice(0, 60), look: String(body.look ?? "").slice(0, 400), outfit: String(body.outfit ?? "").slice(0, 300) };
  const rule = checkCharacter(c);
  if (!rule.ok) return NextResponse.json({ error: rule.reason }, { status: 422 });
  const safe = checkPrompt(`${c.look} ${c.outfit}`);
  if (!safe.ok) return NextResponse.json({ error: safe.reason }, { status: 422 });

  const mode = getMode();
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off until an APP_PASSWORD is set." }, { status: 403 });
  const url = String(body.url ?? "");
  if (mode === "demo") return NextResponse.json({ token: "demo" });
  if (!isFalMediaUrl(url) || !verify(String(body.token ?? ""), "result", url))
    return NextResponse.json({ error: "That look picture can't be used. Please make it again." }, { status: 400 });
  return NextResponse.json({ token: sign("ref", url, "person") });
}
