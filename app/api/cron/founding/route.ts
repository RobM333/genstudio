import { NextResponse } from "next/server";
import { accountsOn } from "@/lib/accounts/config";
import { isCronKey } from "@/lib/accounts/session";
import { runFoundingReminders } from "@/lib/accounts/reminders";

export const dynamic = "force-dynamic";

// Called once a day by netlify/functions/founding-daily.mts, with a key only the
// server knows. Sends the founding price message a few days before a free month
// ends and moves ended months to the Free plan. It never charges anyone.
export async function POST(req: Request) {
  if (!isCronKey(req.headers.get("x-cron-key"))) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (!accountsOn()) return NextResponse.json({ ok: true, on: false });
  const r = await runFoundingReminders(new URL(req.url).origin);
  return NextResponse.json({ ok: true, checked: r.checked, sent: r.sent.length, failed: r.failed.length, movedToFree: r.movedToFree });
}
