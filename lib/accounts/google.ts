import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authSecret } from "./session";
import { cleanEmail } from "../founding";

// "Continue with Google" (OpenID Connect, the standard Google sign-in).
// 1. /api/auth/google sends the person to Google with a one-off "state", a
//    "nonce" and a PKCE check, all kept in a short signed cookie.
// 2. Google sends them back to /api/auth/google/callback with a code. The server
//    swaps the code for Google's ID token straight from Google (with the client
//    secret), checks it's for ToastyFly, fresh, matches the nonce, and that
//    Google has confirmed the email is theirs.
// 3. Then the same invite-only rules as the emailed code decide who gets in.

export const GOOGLE_COOKIE = "tf_google";
const COOKIE_MINUTES = 10;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export type GoogleFlow = { state: string; nonce: string; verifier: string; next: string; exp: number };

const clientId = () => process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (text: string) => createHmac("sha256", authSecret()).update(`google\n${text}`).digest("base64url");

export function redirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

/** A fresh flow, the signed cookie that remembers it, and the Google address to send the person to. */
export function startGoogle(origin: string, next: string, now = Date.now()): { url: string; cookie: string } {
  const flow: GoogleFlow = {
    state: b64(randomBytes(18)),
    nonce: b64(randomBytes(18)),
    verifier: b64(randomBytes(32)),
    next,
    exp: now + COOKIE_MINUTES * 60_000,
  };
  const body = b64(JSON.stringify(flow));
  const q = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: b64(createHash("sha256").update(flow.verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `${AUTH_URL}?${q}`, cookie: `${body}.${mac(body)}` };
}

/** Reads the signed cookie back; null if it was changed, is missing or ran out. */
export function readGoogleCookie(raw: string | null | undefined, now = Date.now()): GoogleFlow | null {
  const [body, sig] = String(raw ?? "").split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const flow = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GoogleFlow;
    return flow.exp > now ? flow : null;
  } catch {
    return null;
  }
}

export type GoogleClaims = { iss?: string; aud?: string | string[]; exp?: number; nonce?: string; email?: string; email_verified?: boolean | string; name?: string };

/** The checks on Google's ID token. Returns the person's email, or why it was refused. */
export function checkClaims(c: GoogleClaims, nonce: string, now = Date.now()): { ok: true; email: string; name?: string } | { ok: false; why: string } {
  if (!ISSUERS.has(String(c.iss))) return { ok: false, why: "issuer" };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!clientId() || !aud.includes(clientId())) return { ok: false, why: "audience" };
  if (!c.exp || c.exp * 1000 < now - 60_000) return { ok: false, why: "expired" };
  if (!c.nonce || c.nonce !== nonce) return { ok: false, why: "nonce" };
  if (c.email_verified !== true && c.email_verified !== "true") return { ok: false, why: "unverified" };
  const email = cleanEmail(c.email);
  if (!email) return { ok: false, why: "email" };
  return { ok: true, email, name: typeof c.name === "string" ? c.name.slice(0, 60) : undefined };
}

/** Swaps Google's one-time code for the ID token, straight from Google over HTTPS. */
export async function exchangeCode(code: string, verifier: string, origin: string): Promise<GoogleClaims | null> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!r?.ok) {
    console.error("google token exchange failed", r?.status, await r?.text().catch(() => ""));
    return null;
  }
  const d = (await r.json().catch(() => null)) as { id_token?: string } | null;
  const part = d?.id_token?.split(".")[1];
  if (!part) return null;
  try {
    // The token came straight from Google's own address over HTTPS, which is
    // what the OpenID rules ask for when a server skips re-checking its signature.
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as GoogleClaims;
  } catch {
    return null;
  }
}
