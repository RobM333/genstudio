import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { kv } from "./kv";
import { getUser, saveUser, signedIn, type PasskeySummary, type User } from "./store";
import { BRAND } from "./config";

// Passkeys: sign in with a fingerprint, face or the phone's screen lock instead
// of waiting for a code. Someone adds one after signing in the usual way, so
// passkeys never let anyone new in: each one belongs to an existing account.
//
// Each "challenge" is a one-off random value kept for 5 minutes and used once.
// Only the passkey's public half is stored; the private half never leaves the
// person's phone or computer (or their password manager).

export const PASSKEY_COOKIE = "tf_pk";
export const MAX_PASSKEYS = 10;
const CHALLENGE_MINUTES = 5;

type Challenge = { challenge: string; purpose: "register" | "signin"; userId?: string; expires: number };
export type StoredPasskey = { userId: string; id: string; publicKey: string; counter: number; transports?: string[]; at: number };

/** Short key for a passkey's id (ids can be long). */
export const passkeyKey = (credentialId: string) => createHash("sha256").update(`passkey:${credentialId}`).digest("hex").slice(0, 40);

/** The site the passkey belongs to: the address it was made on, e.g. toastyfly.com. */
export function site(req: Request): { rpID: string; origin: string } {
  const u = new URL(req.url);
  return { rpID: u.hostname, origin: u.origin };
}

async function saveChallenge(c: Omit<Challenge, "expires">, now = Date.now()): Promise<string> {
  const id = randomBytes(18).toString("base64url");
  await (await kv()).set(`challenge/${id}`, { ...c, expires: now + CHALLENGE_MINUTES * 60_000 });
  return id;
}

/** Each challenge works once. */
async function takeChallenge(id: string | null, purpose: Challenge["purpose"], now = Date.now()): Promise<Challenge | null> {
  if (!id || !/^[A-Za-z0-9_-]{20,40}$/.test(id)) return null;
  const s = await kv();
  const c = await s.get<Challenge>(`challenge/${id}`);
  if (!c) return null;
  await s.delete(`challenge/${id}`);
  return c.purpose === purpose && c.expires > now ? c : null;
}

/** A name to show in the list, from the device that made it. */
export function labelFor(userAgent: string | null): string {
  const ua = String(userAgent ?? "");
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android phone"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows computer"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux computer"
                : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${device}, ${browser}` : device;
}

// ---------- adding a passkey (signed in) ----------

export async function registrationOptions(req: Request, user: User) {
  const { rpID } = site(req);
  const s = await kv();
  const mine = (await Promise.all((user.passkeys ?? []).map((p) => s.get<StoredPasskey>(`passkey/${p.key}`)))).filter((p): p is StoredPasskey => !!p);
  const options = await generateRegistrationOptions({
    rpName: BRAND,
    rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: mine.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = await saveChallenge({ challenge: options.challenge, purpose: "register", userId: user.id });
  return { options, challengeId };
}

export type AddResult = { ok: true; passkey: PasskeySummary } | { ok: false; why: "expired" | "failed" | "too-many" };

export async function addPasskey(req: Request, user: User, challengeId: string | null, response: RegistrationResponseJSON, now = Date.now()): Promise<AddResult> {
  if ((user.passkeys?.length ?? 0) >= MAX_PASSKEYS) return { ok: false, why: "too-many" };
  const c = await takeChallenge(challengeId, "register", now);
  if (!c || c.userId !== user.id) return { ok: false, why: "expired" };
  const { rpID, origin } = site(req);
  const v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false }).catch(
    (e) => {
      console.error("passkey add failed", e);
      return null;
    },
  );
  if (!v?.verified) return { ok: false, why: "failed" };
  const cred = v.registrationInfo.credential;
  const key = passkeyKey(cred.id);
  const s = await kv();
  const stored: StoredPasskey = {
    userId: user.id,
    id: cred.id,
    publicKey: Buffer.from(cred.publicKey).toString("base64url"),
    counter: cred.counter,
    transports: cred.transports,
    at: now,
  };
  // A passkey belongs to one account only.
  if (!(await s.set(`passkey/${key}`, stored, { onlyIfNew: true }))) return { ok: false, why: "failed" };
  const passkey: PasskeySummary = { key, label: labelFor(req.headers.get("user-agent")), at: now };
  await saveUser(user.id, (u) => ({ ...u, passkeys: [...(u.passkeys ?? []).filter((p) => p.key !== key), passkey] }));
  return { ok: true, passkey };
}

export async function removePasskey(user: User, key: string): Promise<boolean> {
  if (!(user.passkeys ?? []).some((p) => p.key === key)) return false;
  const s = await kv();
  const stored = await s.get<StoredPasskey>(`passkey/${key}`);
  if (stored?.userId === user.id) await s.delete(`passkey/${key}`);
  await saveUser(user.id, (u) => ({ ...u, passkeys: (u.passkeys ?? []).filter((p) => p.key !== key) }));
  return true;
}

// ---------- signing in with a passkey ----------

export async function signInOptions(req: Request) {
  const { rpID } = site(req);
  // No list of passkeys: the phone or computer offers the ones it has for this site.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const challengeId = await saveChallenge({ challenge: options.challenge, purpose: "signin" });
  return { options, challengeId };
}

export type PasskeySignIn = { ok: true; user: User } | { ok: false; why: "expired" | "unknown" | "failed" };

export async function signInWithPasskey(req: Request, challengeId: string | null, response: AuthenticationResponseJSON, now = Date.now()): Promise<PasskeySignIn> {
  const c = await takeChallenge(challengeId, "signin", now);
  if (!c) return { ok: false, why: "expired" };
  const s = await kv();
  const key = passkeyKey(String(response?.id ?? ""));
  const stored = await s.get<StoredPasskey>(`passkey/${key}`);
  const user = stored ? await getUser(stored.userId) : null;
  // Removed from the account (or the account was deleted): it can't be used.
  if (!stored || !user || !(user.passkeys ?? []).some((p) => p.key === key)) return { ok: false, why: "unknown" };
  const { rpID, origin } = site(req);
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: c.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: stored.id, publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")), counter: stored.counter, transports: stored.transports },
    requireUserVerification: false,
  }).catch((e) => {
    console.error("passkey sign-in failed", e);
    return null;
  });
  if (!v?.verified) return { ok: false, why: "failed" };
  await s.set(`passkey/${key}`, { ...stored, counter: v.authenticationInfo.newCounter });
  await saveUser(user.id, (u) => ({ ...u, passkeys: (u.passkeys ?? []).map((p) => (p.key === key ? { ...p, lastUsed: now } : p)) }));
  return signedIn(user, "passkey", now);
}
