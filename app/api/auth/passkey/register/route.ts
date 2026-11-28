import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { currentUser, signInNeeded } from "@/lib/accounts/current";
import { addPasskey, MAX_PASSKEYS, registrationOptions } from "@/lib/accounts/passkeys";
import { publicUser } from "@/lib/accounts/public";

export const dynamic = "force-dynamic";

// Adding a passkey to your account (only once you're signed in).
//   POST {}                         -> the options for the phone or computer
//   POST { challengeId, response }  -> saves the new passkey
export async function POST(req: Request) {
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  const body = (await req.json().catch(() => ({}))) as { challengeId?: string; response?: RegistrationResponseJSON };
  if (!body.response) {
    if ((user.passkeys?.length ?? 0) >= MAX_PASSKEYS)
      return NextResponse.json({ error: `You already have ${MAX_PASSKEYS} passkeys. Remove one first.` }, { status: 400 });
    return NextResponse.json(await registrationOptions(req, user), { headers: { "Cache-Control": "no-store" } });
  }
  const r = await addPasskey(req, user, String(body.challengeId ?? ""), body.response);
  if (!r.ok) {
    const error =
      r.why === "too-many"
        ? `You already have ${MAX_PASSKEYS} passkeys. Remove one first.`
        : r.why === "expired"
          ? "That took a little too long. Please try again."
          : "We couldn't add that passkey. Please try again.";
    return NextResponse.json({ error }, { status: 400 });
  }
  const fresh = await currentUser(req);
  return NextResponse.json({ ok: true, passkey: r.passkey, user: fresh ? publicUser(fresh) : undefined });
}
