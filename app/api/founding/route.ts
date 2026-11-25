import { NextResponse, type NextRequest } from "next/server";
import { cleanEmail, cleanMakes, cleanText, foundingFull, spotsLeft, TOTAL_SPOTS } from "@/lib/founding";
import { addSignup, countSignups, markFullMessageSent } from "@/lib/foundingStore";
import { recordReferral, refCodeFor } from "@/lib/accounts/referrals";
import { listInvites } from "@/lib/accounts/store";
import { foundingFullEmail, sendEmail } from "@/lib/accounts/mail";

/** How many Founding members the owner has invited (0 if that can't be read). */
async function foundingInvites(): Promise<number> {
  try {
    return (await listInvites()).filter((i) => i.founding).length;
  } catch {
    return 0;
  }
}

// Public (no app password): the founding sign-up page reads how many spots are
// left and sends new sign-ups here.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Spots go when the owner invites someone, not when they sign up.
    const invited = await foundingInvites();
    const full = foundingFull(invited);
    return NextResponse.json({ total: TOTAL_SPOTS, left: spotsLeft(invited), full });
  } catch {
    return NextResponse.json({ total: TOTAL_SPOTS, left: null, full: false });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 400 });
  }

  // Hidden field that people never see. Bots fill it in; pretend it worked.
  if (cleanText(body.website)) return NextResponse.json({ ok: true, status: "added", left: null });

  const email = cleanEmail(body.email);
  if (!email) return NextResponse.json({ error: "Please check your email address." }, { status: 400 });
  if (body.agree !== true) {
    return NextResponse.json({ error: "Please tick the box so we can email you about your spot." }, { status: 400 });
  }

  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    const status = await addSignup(
      { email, name: cleanText(body.name, 60), makes: cleanMakes(body.makes), at: new Date().toISOString() },
      ip,
    );
    if (status === "too-many") {
      return NextResponse.json({ error: "Lots of sign-ups have come from this connection today. Please try again tomorrow." }, { status: 429 });
    }
    // A friend's invite link: remembered now, the bonus is added once both have accounts.
    const referral = status === "added" && body.ref ? await recordReferral(body.ref, email).catch(() => "no-code" as const) : null;
    const refCode = await refCodeFor(email).catch(() => null);
    const [taken, invited] = await Promise.all([countSignups(), foundingInvites()]);
    // Once 100 Founding members are invited, new sign-ups join the early list, and we tell them so by email too.
    const full = foundingFull(invited);
    if (status === "added" && full) {
      const mail = foundingFullEmail({ name: cleanText(body.name, 60) || undefined, link: new URL(req.url).origin });
      const sent = await sendEmail(email, mail.subject, mail.text, mail.html).catch(() => ({ ok: false }));
      if (sent.ok) await markFullMessageSent(email).catch(() => {});
    }
    return NextResponse.json({
      ok: true,
      status,
      full,
      left: spotsLeft(invited),
      number: status === "added" ? taken : null,
      refCode,
      referred: referral === "recorded",
    });
  } catch {
    return NextResponse.json({ error: "We couldn't save that just now. Please try again in a minute." }, { status: 503 });
  }
}
