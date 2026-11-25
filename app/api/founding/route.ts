import { NextResponse, type NextRequest } from "next/server";
import { cleanEmail, cleanMakes, cleanText, spotsLeft, TOTAL_SPOTS } from "@/lib/founding";
import { addSignup, countSignups } from "@/lib/foundingStore";
import { recordReferral, refCodeFor } from "@/lib/accounts/referrals";

// Public (no app password): the founding sign-up page reads how many spots are
// left and sends new sign-ups here.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const taken = await countSignups();
    return NextResponse.json({ total: TOTAL_SPOTS, left: spotsLeft(taken) });
  } catch {
    return NextResponse.json({ total: TOTAL_SPOTS, left: null });
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
    const taken = await countSignups();
    return NextResponse.json({
      ok: true,
      status,
      left: spotsLeft(taken),
      number: status === "added" ? taken : null,
      refCode,
      referred: referral === "recorded",
    });
  } catch {
    return NextResponse.json({ error: "We couldn't save that just now. Please try again in a minute." }, { status: 503 });
  }
}
