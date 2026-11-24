import { NextResponse } from "next/server";
import { currentUser, signInNeeded } from "@/lib/accounts/current";
import { isDataName, MAX_DATA_BYTES, readData, writeData } from "@/lib/accounts/store";

export const dynamic = "force-dynamic";

// The studio's saved work (gallery, Brand kit, references, ideas, chat, the
// "You, talking" setup and the ElevenLabs connection), kept with the account so
// it follows the person to any device.

export async function GET(req: Request) {
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  return NextResponse.json({ data: await readData(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  const body = (await req.json().catch(() => null)) as { name?: string; text?: string | null } | null;
  if (!body || !isDataName(body.name)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const text = body.text === null ? null : typeof body.text === "string" ? body.text : undefined;
  if (text === undefined) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (text !== null) {
    try {
      JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
  }
  if (!(await writeData(user.id, body.name, text)))
    return NextResponse.json({ error: `Too much to save at once (over ${Math.round(MAX_DATA_BYTES / 1e6)} MB).` }, { status: 413 });
  return NextResponse.json({ ok: true });
}
