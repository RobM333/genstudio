import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { accountsOn } from "@/lib/accounts/config";
import { signInWithPasskey } from "@/lib/accounts/passkeys";
import { setSignedIn } from "@/lib/accounts/signin";

export const dynamic = "force-dynamic";

// Signing in with a passkey, step 2: check the signed challenge, then set the sign-in cookie.
export async function POST(req: Request) {
  if (!accountsOn()) return NextResponse.json({ error: "Sign-in isn't switched on yet." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { challengeId?: string; response?: AuthenticationResponseJSON };
  if (!body.response) return NextResponse.json({ error: "That didn't work. Please try again." }, { status: 400 });
  const r = await signInWithPasskey(req, String(body.challengeId ?? ""), body.response);
  if (!r.ok) {
    const error =
      r.why === "unknown"
        ? "We don't know that passkey. It may have been removed. Please sign in with Google or your email, then add a new one."
        : r.why === "expired"
          ? "That took a little too long. Please try again."
          : "That passkey didn't work. Please try again, or sign in with your email.";
    return NextResponse.json({ error }, { status: 400 });
  }
  return setSignedIn(req, NextResponse.json({ ok: true }), r.user);
}
