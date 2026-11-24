// The sign-in cookie. It holds the person's account id, a version number (bumped
// to sign them out everywhere) and when it runs out, signed so it can't be faked.
// The proxy checks the signature; the server checks the account still exists.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tf_session";
export const SESSION_DAYS = 30;

export function authSecret(): string {
  const own = process.env.AUTH_SECRET?.trim();
  if (own) return own;
  // Derived from secrets only the server has. Changing one of them signs everyone out, which is safe.
  return createHash("sha256")
    .update(`${process.env.FAL_KEY ?? ""}|${process.env.RESEND_API_KEY ?? ""}|${process.env.APP_PASSWORD ?? ""}|toastyfly-sessions`)
    .digest("hex");
}

function mac(text: string): string {
  return createHmac("sha256", authSecret()).update(`session\n${text}`).digest("base64url");
}

export function makeSession(userId: string, version: number, now = Date.now(), days = SESSION_DAYS): string {
  const body = `${userId}.${version}.${now + days * 86400_000}`;
  return `${body}.${mac(body)}`;
}

export type Session = { userId: string; version: number; expires: number };

export function readSession(token: string | null | undefined, now = Date.now()): Session | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 4) return null;
  const [userId, v, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(userId) || !/^\d{1,6}$/.test(v) || !/^\d{10,16}$/.test(exp)) return null;
  const want = Buffer.from(mac(`${userId}.${v}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Number(exp) < now) return null;
  return { userId, version: Number(v), expires: Number(exp) };
}

/** Reads one cookie from a Cookie header. */
export function cookieFrom(header: string | null | undefined, name = SESSION_COOKIE): string | null {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
