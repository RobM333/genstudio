import "server-only";
import { NextResponse } from "next/server";
import { makeSession, SESSION_COOKIE, SESSION_DAYS } from "./session";
import { settleReferrals } from "./referrals";
import type { User } from "./store";

// The last step of every way of signing in (emailed code, Google, passkey):
// add any sharing reward that was waiting, then set the sign-in cookie.

export function isHttps(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

export async function setSignedIn<T extends NextResponse>(req: Request, res: T, user: User): Promise<T> {
  await settleReferrals(user).catch((e) => console.error("referral settle failed", e));
  res.cookies.set(SESSION_COOKIE, makeSession(user.id, user.sv), {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}

/** Only our own pages, never another site. */
export function safeNext(raw: unknown): string {
  const next = String(raw ?? "");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next.slice(0, 300) : "/studio";
}
