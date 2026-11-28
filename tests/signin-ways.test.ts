import assert from "node:assert/strict";
// Run with: tsx --conditions=react-server tests/signin-ways.test.ts
// "Continue with Google" and passkeys: same invite-only rules as the emailed code.
import { useMemoryKV } from "../lib/accounts/kv";
import { googleOn } from "../lib/accounts/config";
import { checkClaims, readGoogleCookie, startGoogle } from "../lib/accounts/google";
import { labelFor, passkeyKey, removePasskey, signInWithPasskey } from "../lib/accounts/passkeys";
import { isSignInPath } from "../lib/publicPaths";
import { safeNext } from "../lib/accounts/signin";
import * as store from "../lib/accounts/store";

async function main() {
  const s = useMemoryKV();
  process.env.FAL_KEY = "test-key";
  process.env.RESEND_API_KEY = "re_test";
  process.env.ADMIN_EMAILS = "owner@example.com";

  // ---- switched on only with both Google settings ----
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal(googleOn(), false);
  process.env.GOOGLE_CLIENT_ID = "abc.apps.googleusercontent.com";
  assert.equal(googleOn(), false, "needs the secret too");
  process.env.GOOGLE_CLIENT_SECRET = "shh";
  assert.equal(googleOn(), true);

  // ---- the trip to Google ----
  const now = Date.UTC(2026, 10, 28, 12);
  const g = startGoogle("https://toastyfly.com", "/studio", now);
  const to = new URL(g.url);
  assert.equal(to.origin + to.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(to.searchParams.get("redirect_uri"), "https://toastyfly.com/api/auth/google/callback");
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  assert.equal(to.searchParams.get("scope"), "openid email profile");
  assert.ok(!g.url.includes("shh"), "the secret never goes in the address");
  const flow = readGoogleCookie(g.cookie, now + 1000)!;
  assert.equal(flow.state, to.searchParams.get("state"));
  assert.equal(flow.nonce, to.searchParams.get("nonce"));
  assert.equal(readGoogleCookie(g.cookie, now + 11 * 60_000), null, "runs out after 10 minutes");
  const [body, sig] = g.cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ ...flow, next: "/admin" })).toString("base64url");
  assert.equal(readGoogleCookie(`${forged}.${sig}`, now), null, "can't be changed");
  assert.equal(readGoogleCookie(`${body}.x`, now), null);

  // ---- checks on Google's answer ----
  const good = { iss: "https://accounts.google.com", aud: "abc.apps.googleusercontent.com", exp: now / 1000 + 600, nonce: flow.nonce, email: "Friend@Gmail.com", email_verified: true };
  assert.deepEqual(checkClaims(good, flow.nonce, now), { ok: true, email: "friend@gmail.com", name: undefined });
  assert.equal((checkClaims({ ...good, aud: "someone-else" }, flow.nonce, now) as { why: string }).why, "audience");
  assert.equal((checkClaims({ ...good, iss: "https://evil.example" }, flow.nonce, now) as { why: string }).why, "issuer");
  assert.equal((checkClaims({ ...good, nonce: "other" }, flow.nonce, now) as { why: string }).why, "nonce");
  assert.equal((checkClaims({ ...good, email_verified: false }, flow.nonce, now) as { why: string }).why, "unverified");
  assert.equal((checkClaims({ ...good, exp: now / 1000 - 3600 }, flow.nonce, now) as { why: string }).why, "expired");

  // ---- invite-only, whichever way ----
  assert.equal(await store.signInWithEmail("stranger@gmail.com", "google", now), null, "strangers stay out");
  assert.equal(await store.findUserByEmail("stranger@gmail.com"), null, "and no account is made");
  await store.invite("friend@gmail.com", { founding: true, group: 1 }, now);
  const first = (await store.signInWithEmail("friend@gmail.com", "google", now))!;
  assert.ok(first.ok && first.user.founding && first.user.lastMethod === "google");
  assert.equal(first.user.credits, 500, "Founding credits added on first sign-in, like the code");
  const again = (await store.signInWithEmail("FRIEND@gmail.com", "code", now + 1000))!;
  assert.equal(again.user.id, first.user.id, "Google and the emailed code reach the same account");
  assert.equal(again.user.credits, 500, "credits only added once");
  const owner = (await store.signInWithEmail("owner@example.com", "google", now))!;
  assert.ok(owner.user.admin);

  // ---- passkeys ----
  assert.ok(isSignInPath("/api/auth/google/callback") && isSignInPath("/api/auth/passkey/verify"));
  assert.ok(!isSignInPath("/api/auth/passkey/register"), "adding a passkey needs you signed in");
  assert.equal(labelFor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), "iPhone, Safari");
  assert.equal(labelFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36"), "Windows computer, Chrome");
  const req = new Request("https://toastyfly.com/api/auth/passkey/verify", { method: "POST" });
  assert.deepEqual(await signInWithPasskey(req, "nope", { id: "x" } as never), { ok: false, why: "expired" });

  // A removed passkey (or one from a deleted account) can't sign in.
  const key = passkeyKey("cred-1");
  await s.set(`passkey/${key}`, { userId: first.user.id, id: "cred-1", publicKey: "", counter: 0, at: now });
  await store.saveUser(first.user.id, (u) => ({ ...u, passkeys: [{ key, label: "iPhone, Safari", at: now }] }));
  const u1 = (await store.getUser(first.user.id))!;
  assert.equal(await removePasskey(u1, "not-mine"), false);
  assert.equal(await removePasskey(u1, key), true);
  assert.equal(await s.get(`passkey/${key}`), null);
  assert.equal((await store.getUser(first.user.id))!.passkeys!.length, 0);

  await s.set(`passkey/${key}`, { userId: first.user.id, id: "cred-1", publicKey: "", counter: 0, at: now });
  await store.saveUser(first.user.id, (u) => ({ ...u, passkeys: [{ key, label: "iPhone, Safari", at: now }] }));
  assert.ok(await store.deleteAccount(first.user.id));
  assert.equal(await s.get(`passkey/${key}`), null, "deleting the account deletes its passkeys");

  // ---- where people go afterwards ----
  assert.equal(safeNext("/studio?x=1"), "/studio?x=1");
  assert.equal(safeNext("//evil.example"), "/studio");
  assert.equal(safeNext("https://evil.example"), "/studio");
  assert.equal(safeNext("/\\evil.example"), "/studio");

  console.log("sign-in ways tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
