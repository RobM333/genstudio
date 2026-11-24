// Accounts: each person signs in with their email and has their own credits and
// saved work. Switched on by two settings in Netlify, so the app keeps working
// exactly as before (one shared password) until they exist:
//   RESEND_API_KEY  the key for Resend, the service that emails sign-in codes
//   ADMIN_EMAILS    the owner's email (or several, separated by commas)
// Optional: EMAIL_FROM (for example "ToastyFly <hello@toastyfly.com>", once the
// domain is set up in Resend) and AUTH_SECRET (otherwise one is derived from the
// server's other secrets).
// No "server-only" here: the proxy (the gate in front of every page) reads it too.

import { cleanEmail } from "../founding";

export const BRAND = "ToastyFly";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => cleanEmail(e))
    .filter((e): e is string => !!e);
}

/** Are accounts switched on? Only when sign-in emails can be sent and someone can run it. */
export function accountsOn(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim()) && adminEmails().length > 0;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const e = cleanEmail(email ?? "");
  return !!e && adminEmails().includes(e);
}
