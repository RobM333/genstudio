import { NextResponse } from "next/server";
import { currentUser, signInNeeded } from "@/lib/accounts/current";
import { changeCredits, getUser, invite, listInvites, listUsers } from "@/lib/accounts/store";
import { shownCredits } from "@/lib/accounts/credits";
import { inviteEmail, sendEmail } from "@/lib/accounts/mail";
import { listSignups } from "@/lib/foundingStore";
import { TOTAL_SPOTS } from "@/lib/founding";

export const dynamic = "force-dynamic";

// The owner's page: invite people (the Founding 100 or anyone else), see who has
// joined, and add credits. Only for the emails in ADMIN_EMAILS.

async function admin(req: Request) {
  const user = await currentUser(req);
  return user?.admin ? user : null;
}

export async function GET(req: Request) {
  if (!(await currentUser(req))) return signInNeeded();
  if (!(await admin(req))) return NextResponse.json({ error: "Only the owner can see this." }, { status: 403 });
  const [users, invites, signups] = await Promise.all([listUsers(), listInvites(), listSignups()]);
  return NextResponse.json(
    {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name ?? "",
        credits: shownCredits(u.credits),
        plan: u.plan,
        planUntil: u.planUntil ?? null,
        founding: Boolean(u.founding),
        createdAt: u.createdAt,
        lastSignIn: u.lastSignIn ?? null,
      })),
      invites: invites.map((i) => ({ email: i.email, name: i.name ?? "", credits: i.credits, founding: Boolean(i.founding), at: i.at, joined: Boolean(i.usedAt) })),
      signups: signups.map((s, n) => ({ ...s, spot: n < TOTAL_SPOTS })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const me = await admin(req);
  if (!me) return NextResponse.json({ error: "Only the owner can do this." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; email?: string; name?: string; founding?: boolean; credits?: number; userId?: string; note?: string };

  if (b.action === "invite") {
    const r = await invite(String(b.email ?? ""), { name: b.name, founding: b.founding, credits: b.credits });
    if (!r) return NextResponse.json({ error: "Please check the email address." }, { status: 400 });
    const link = `${new URL(req.url).origin}/signin?email=${encodeURIComponent(r.invite.email)}`;
    const mail = inviteEmail({ name: r.invite.name, link, founding: Boolean(r.invite.founding), credits: r.invite.credits });
    const sent = await sendEmail(r.invite.email, mail.subject, mail.text, mail.html);
    return NextResponse.json({ ok: true, existing: r.existing, emailed: sent.ok, emailProblem: sent.ok ? undefined : sent.error, link });
  }

  if (b.action === "credits") {
    const credits = Math.round(Number(b.credits));
    const user = await getUser(String(b.userId ?? ""));
    if (!user || !credits || Math.abs(credits) > 100000) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const r = await changeCredits(user.id, credits, "admin", String(b.note || (credits > 0 ? "Credits from ToastyFly" : "Credits taken off")).slice(0, 120));
    if (!r.ok) return NextResponse.json({ error: "That would take the balance below zero." }, { status: 400 });
    return NextResponse.json({ ok: true, credits: shownCredits(r.user.credits) });
  }

  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
