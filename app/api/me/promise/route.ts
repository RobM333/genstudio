import { NextResponse } from "next/server";
import { currentUser, signInNeeded } from "@/lib/accounts/current";
import { promiseAction } from "@/lib/accounts/store";
import { shownCredits } from "@/lib/accounts/credits";
import { COVERED_CODES, type FaultCode } from "@/lib/promise";

export const dynamic = "force-dynamic";

// The "no wasted credits" promise: the studio's automatic check found a clear
// fault, so the credits for that job come back (or a free remake is counted).
// The limits are kept here, on the server: once per job, 10 a month, and never
// more than was charged in the last few hours.
export async function POST(req: Request) {
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  const b = (await req.json().catch(() => ({}))) as { itemId?: string; kind?: string; credits?: number; fault?: string; what?: string };
  const kind = b.kind === "free_remake" ? "free_remake" : "refund";
  const fault = (COVERED_CODES as string[]).includes(String(b.fault)) ? (b.fault as FaultCode) : undefined;
  if (kind === "refund" && (!fault || fault === "failed")) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const r = await promiseAction(user.id, { itemId: String(b.itemId ?? ""), kind, credits: Number(b.credits) || 0, fault, what: String(b.what ?? "").slice(0, 120) });
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason });
  return NextResponse.json({ ok: true, credits: r.credits, balance: shownCredits(r.user.credits) });
}
