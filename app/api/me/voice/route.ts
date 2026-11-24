import { NextResponse } from "next/server";
import { currentUser, signInNeeded } from "@/lib/accounts/current";
import { deleteVoice } from "@/lib/accounts/store";

export const dynamic = "force-dynamic";

/** Deletes the person's voice copy for "You, talking". It can't be used again after this. */
export async function DELETE(req: Request) {
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  await deleteVoice(user.id);
  return NextResponse.json({ ok: true });
}
