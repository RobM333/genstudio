import { NextResponse } from "next/server";
import { accountsOn } from "@/lib/accounts/config";
import { currentUser, signInNeeded } from "@/lib/accounts/current";
import { deleteAccount, history } from "@/lib/accounts/store";
import { publicUser } from "@/lib/accounts/public";
import { SESSION_COOKIE } from "@/lib/accounts/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!accountsOn()) return NextResponse.json({ on: false }, { headers: { "Cache-Control": "no-store" } });
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  const withHistory = new URL(req.url).searchParams.get("history") === "1";
  return NextResponse.json(
    { on: true, user: publicUser(user), history: withHistory ? await history(user.id, 60) : undefined },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Deletes the account and everything saved with it. */
export async function DELETE(req: Request) {
  const user = await currentUser(req);
  if (!user) return signInNeeded();
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (String(body.confirm ?? "").trim().toUpperCase() !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  await deleteAccount(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
