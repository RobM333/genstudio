import { NextResponse } from "next/server";
import { currentUser, signInNeeded } from "@/lib/accounts/current";
import { removePasskey } from "@/lib/accounts/passkeys";

export const dynamic = "force-dynamic";

/** Removes one of your passkeys. It can't be used to sign in after this. */
export async function DELETE(req: Request) {
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!(await removePasskey(user, key))) return NextResponse.json({ error: "We couldn't find that passkey." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
