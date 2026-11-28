import { NextResponse } from "next/server";
import { accountsOn } from "@/lib/accounts/config";
import { signInOptions } from "@/lib/accounts/passkeys";

export const dynamic = "force-dynamic";

// Signing in with a passkey, step 1: a one-off challenge for the phone or computer to sign.
export async function POST(req: Request) {
  if (!accountsOn()) return NextResponse.json({ error: "Sign-in isn't switched on yet." }, { status: 404 });
  return NextResponse.json(await signInOptions(req), { headers: { "Cache-Control": "no-store" } });
}
