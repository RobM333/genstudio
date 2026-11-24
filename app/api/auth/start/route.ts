import { NextResponse } from "next/server";
import { accountsOn } from "@/lib/accounts/config";
import { startSignIn } from "@/lib/accounts/store";
import { codeEmail, sendEmail } from "@/lib/accounts/mail";

export const dynamic = "force-dynamic";

// Step 1 of signing in: email a 6-digit code. Invite-only for now.
export async function POST(req: Request) {
  if (!accountsOn()) return NextResponse.json({ error: "Sign-in isn't switched on yet." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const r = await startSignIn(String(body.email ?? ""));
  if (!r.ok) {
    if (r.reason === "bad-email") return NextResponse.json({ error: "Please check your email address." }, { status: 400 });
    if (r.reason === "too-many") return NextResponse.json({ error: "Too many codes asked for. Please wait an hour and try again." }, { status: 429 });
    return NextResponse.json(
      { error: "ToastyFly is invite-only for now, and this email isn't on the list yet. You can claim a Founding spot to get an invite.", notInvited: true },
      { status: 403 },
    );
  }
  // Local test runs only (never on the live site): print the code instead of emailing it.
  if (process.env.NODE_ENV !== "production" && process.env.ACCOUNTS_DEV_LOG_CODES === "1") {
    console.log(`[dev] sign-in code for ${body.email}: ${r.code}`);
    return NextResponse.json({ ok: true });
  }
  const mail = codeEmail(r.code);
  const sent = await sendEmail(String(body.email).trim().toLowerCase(), mail.subject, mail.text, mail.html);
  if (!sent.ok) return NextResponse.json({ error: "We couldn't send the email just now. Please try again in a minute." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
