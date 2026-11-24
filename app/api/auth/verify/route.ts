import { NextResponse } from "next/server";
import { accountsOn } from "@/lib/accounts/config";
import { finishSignIn } from "@/lib/accounts/store";
import { makeSession, SESSION_COOKIE, SESSION_DAYS } from "@/lib/accounts/session";

export const dynamic = "force-dynamic";

// Step 2 of signing in: check the code, then set the sign-in cookie.
export async function POST(req: Request) {
  if (!accountsOn()) return NextResponse.json({ error: "Sign-in isn't switched on yet." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; code?: string };
  const r = await finishSignIn(String(body.email ?? ""), String(body.code ?? ""));
  if (!r.ok) {
    const error =
      r.reason === "expired"
        ? "That code has run out. Please ask for a new one."
        : r.reason === "not-invited"
          ? "This email isn't on the invite list."
          : "That code isn't right. Please check it and try again.";
    return NextResponse.json({ error, expired: r.reason === "expired" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, admin: Boolean(r.user.admin) });
  res.cookies.set(SESSION_COOKIE, makeSession(r.user.id, r.user.sv), {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
