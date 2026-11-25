import assert from "node:assert/strict";
// Run with: tsx --conditions=react-server tests/accounts.test.ts (the store is server-only)
import { useMemoryKV } from "../lib/accounts/kv";
import { makeSession, readSession, cookieFrom } from "../lib/accounts/session";
import { accountsOn, adminEmails, isAdminEmail } from "../lib/accounts/config";
import { creditsForUsd, generateUsd, shownCredits, toolUsd, talkVideoUsd } from "../lib/accounts/credits";
import { creditsFor } from "../lib/pricing";
import { getModel } from "../lib/models";
import { isPublicPath, isSignInPath } from "../lib/publicPaths";
import * as store from "../lib/accounts/store";
import { mergeLists } from "../components/account/sync";
import * as refs from "../lib/accounts/referrals";
import { cronKey, isCronKey } from "../lib/accounts/session";
import { isCronPath } from "../lib/publicPaths";

async function main() {
  useMemoryKV();
  process.env.FAL_KEY = "test-key";

  // ---- switched on only with both settings ----
  delete process.env.RESEND_API_KEY;
  process.env.ADMIN_EMAILS = "Owner@Example.com, second@example.com";
  assert.equal(accountsOn(), false);
  process.env.RESEND_API_KEY = "re_test";
  assert.equal(accountsOn(), true);
  assert.deepEqual(adminEmails(), ["owner@example.com", "second@example.com"]);
  assert.ok(isAdminEmail(" OWNER@example.com"));
  assert.ok(!isAdminEmail("someone@example.com"));

  // ---- sign-in cookie ----
  const t = makeSession("abcdefgh12345678", 3, 1_000_000);
  assert.deepEqual(readSession(t, 1_000_001), { userId: "abcdefgh12345678", version: 3, expires: 1_000_000 + 30 * 86400_000 });
  assert.equal(readSession(t, 1_000_000 + 31 * 86400_000), null, "runs out after 30 days");
  assert.equal(readSession(t.replace(".3.", ".4."), 1_000_001), null, "can't be changed");
  assert.equal(readSession("nonsense"), null);
  assert.equal(cookieFrom("a=1; tf_session=xyz; b=2"), "xyz");

  // ---- public pages ----
  assert.ok(isSignInPath("/signin") && isSignInPath("/api/auth/start/"));
  assert.ok(!isPublicPath("/studio") && !isSignInPath("/studio") && !isSignInPath("/api/me"));

  // ---- credits for each step ----
  const schnell = getModel("fal-ai/flux/schnell")!;
  assert.ok(creditsForUsd(generateUsd(schnell, undefined, true)) <= creditsFor(generateUsd(schnell, undefined, true)), "never more than the estimate shown");
  const kling = getModel("fal-ai/kling-video/v2.5-turbo/pro/text-to-video")!;
  assert.equal(generateUsd(kling, 10, true), generateUsd(kling, 10, false), "a silent model's sound is its own step");
  assert.ok(toolUsd("voice", { text: "x".repeat(1000) }) > 0 && toolUsd("nope", {}) === 0);
  assert.ok(talkVideoUsd("hello there friends") >= 3 * 0.115 - 1e-9);
  assert.equal(shownCredits(12.97), 12);
  assert.equal(creditsForUsd(0), 0);

  // ---- invite-only sign-in ----
  const stranger = await store.startSignIn("stranger@example.com");
  assert.deepEqual(stranger, { ok: false, reason: "not-invited" });
  assert.deepEqual(await store.startSignIn("bad"), { ok: false, reason: "bad-email" });

  const now = Date.UTC(2026, 10, 24, 12);
  const owner = await store.startSignIn("owner@example.com", now);
  assert.ok(owner.ok);
  assert.deepEqual(await store.finishSignIn("owner@example.com", "000000" === (owner as { code: string }).code ? "111111" : "000000", now), { ok: false, reason: "wrong" });
  const signedIn = await store.finishSignIn("owner@example.com", (owner as { code: string }).code, now);
  assert.ok(signedIn.ok);
  const ownerUser = (signedIn as { user: store.User }).user;
  assert.equal(ownerUser.admin, true);
  assert.equal(ownerUser.credits, store.OWNER_START_CREDITS);
  // A code only works once.
  assert.deepEqual(await store.finishSignIn("owner@example.com", (owner as { code: string }).code, now), { ok: false, reason: "expired" });

  // Codes run out after 10 minutes, and 5 wrong tries stop them.
  const c2 = (await store.startSignIn("owner@example.com", now)) as { code: string };
  assert.deepEqual(await store.finishSignIn("owner@example.com", c2.code, now + 11 * 60_000), { ok: false, reason: "expired" });
  const c3 = (await store.startSignIn("owner@example.com", now)) as { code: string };
  for (let i = 0; i < 5; i++) await store.finishSignIn("owner@example.com", c3.code === "999999" ? "999998" : "999999", now);
  assert.deepEqual(await store.finishSignIn("owner@example.com", c3.code, now), { ok: false, reason: "expired" });
  // At most 5 codes an hour.
  await store.startSignIn("owner@example.com", now);
  await store.startSignIn("owner@example.com", now);
  assert.deepEqual(await store.startSignIn("owner@example.com", now), { ok: false, reason: "too-many" });

  // ---- Founding invite ----
  const inv = await store.invite("Fan@Example.com", { name: "Sam", founding: true }, now);
  assert.equal(inv?.existing, false);
  assert.equal(inv?.invite.credits, 500);
  const fc = (await store.startSignIn("fan@example.com", now)) as { ok: true; code: string };
  assert.ok(fc.ok);
  const fan = ((await store.finishSignIn("fan@example.com", fc.code, now)) as { user: store.User }).user;
  assert.equal(fan.credits, 500);
  assert.equal(fan.plan, "creator");
  assert.equal(fan.planUntil, "2026-12-24");
  assert.equal(fan.founding, true);
  assert.ok(!fan.admin);
  // Signing in again doesn't add the credits twice.
  const fc2 = (await store.startSignIn("fan@example.com", now + 1000)) as { code: string };
  const again = ((await store.finishSignIn("fan@example.com", fc2.code, now + 1000)) as { user: store.User }).user;
  assert.equal(again.id, fan.id);
  assert.equal(again.credits, 500);
  // A second Founding invite to the same person does nothing.
  assert.equal((await store.invite("fan@example.com", { founding: true }, now))?.existing, true);
  assert.equal((await store.getUser(fan.id))!.credits, 500);

  // ---- charging, running out, and refunds ----
  const ch = await store.chargeStep(fan.id, 120, "Kling 4, 10s");
  assert.ok(ch.ok && ch.user.credits === 380);
  await store.recordCharge("req-12345678", { userId: fan.id, credits: 120, what: "Kling 4, 10s", at: now });
  assert.equal(await store.refundCharge("req-12345678", ownerUser.id, "x"), 0, "only the payer's own job");
  assert.equal(await store.refundCharge("req-12345678", fan.id, "it failed"), 120);
  assert.equal(await store.refundCharge("req-12345678", fan.id, "it failed"), 0, "only once");
  assert.equal((await store.getUser(fan.id))!.credits, 500);
  const tooMuch = await store.chargeStep(fan.id, 501, "Big job");
  assert.deepEqual(tooMuch, { ok: false, reason: "not-enough", balance: 500 });
  // Many at once never go below zero.
  const results = await Promise.all(Array.from({ length: 12 }, () => store.chargeStep(fan.id, 50, "Picture")));
  assert.equal(results.filter((r) => r.ok).length, 10);
  assert.equal((await store.getUser(fan.id))!.credits, 0);
  await store.changeCredits(fan.id, 300, "admin", "Top-up");
  const hist = await store.history(fan.id, 100);
  assert.equal(hist[0].type, "admin");
  assert.equal(hist[0].balance, 300);
  assert.ok(hist.some((h) => h.type === "refund"));

  // ---- the promise: once per job, capped, never more than charged ----
  await store.chargeStep(fan.id, 70, "Kling 2.5, 10s");
  const p1 = await store.promiseAction(fan.id, { itemId: "item-1", kind: "refund", credits: 70, fault: "garbled_text", what: "garbled words" });
  assert.ok(p1.ok && p1.credits === 70);
  assert.deepEqual(await store.promiseAction(fan.id, { itemId: "item-1", kind: "refund", credits: 70, fault: "garbled_text", what: "again" }), { ok: false, reason: "already" });
  // Recent charges were 12 x 50 (minus refunds); asking for far more is cut down to what was charged.
  const big = await store.promiseAction(fan.id, { itemId: "item-2", kind: "refund", credits: 99999, fault: "missing_item", what: "missing dog" });
  assert.ok(big.ok && big.credits < 99999 && big.credits <= 620);
  await store.chargeStep(fan.id, 50, "Another picture");
  for (let i = 3; i <= 10; i++) await store.promiseAction(fan.id, { itemId: `item-${i}`, kind: "free_remake", credits: 1, what: "remake" });
  assert.deepEqual(await store.promiseAction(fan.id, { itemId: "item-11", kind: "refund", credits: 5, fault: "missing_item", what: "x" }), { ok: false, reason: "capped" });

  // ---- saved work, with the ElevenLabs key encrypted ----
  await store.writeData(fan.id, "gallery", JSON.stringify([{ id: "a" }]));
  await store.writeData(fan.id, "elevenlabs", JSON.stringify({ key: "sk_secret_123" }));
  const data = await store.readData(fan.id);
  assert.equal(data.gallery, '[{"id":"a"}]');
  assert.equal(JSON.parse(data.elevenlabs!).key, "sk_secret_123");
  const { kv } = await import("../lib/accounts/kv");
  const raw = JSON.stringify(await (await kv()).get(`data/${fan.id}/elevenlabs`));
  assert.ok(!raw.includes("sk_secret_123"), "the key is never stored readable");
  assert.equal(await store.writeData(fan.id, "gallery", "x".repeat(store.MAX_DATA_BYTES + 1)), false);
  assert.equal(store.unseal(store.seal("hello")), "hello");
  assert.equal(store.unseal("v1.bad.bad.bad"), null);

  // Merging this browser's work into the account on first sign-in.
  assert.equal(mergeLists('[{"id":"a"},{"id":"b"}]', '[{"id":"b"},{"id":"c"}]'), '[{"id":"a"},{"id":"b"},{"id":"c"}]');
  assert.equal(mergeLists('{"x":1}', '[{"id":"c"}]'), '{"x":1}');

  // ---- voice copy: delete, and it stays deleted ----
  await store.writeData(fan.id, "talk", JSON.stringify({ voice: { id: "v1", token: "t" }, photo: { url: "p", token: "t" } }));
  await store.setVoice(fan.id, "v1");
  assert.equal((await store.getUser(fan.id))!.voice?.id, "v1");
  await store.deleteVoice(fan.id);
  const afterVoice = (await store.getUser(fan.id))!;
  assert.equal(afterVoice.voice, undefined);
  assert.deepEqual(afterVoice.deletedVoices, ["v1"]);
  assert.deepEqual(JSON.parse((await store.readData(fan.id)).talk!), { photo: { url: "p", token: "t" } });

  // ---- deleting the account removes everything, and the email can't sign in again ----
  assert.equal(await store.deleteAccount(fan.id), true);
  assert.equal(await store.getUser(fan.id), null);
  assert.equal(await store.findUserByEmail("fan@example.com"), null);
  assert.deepEqual(await store.readData(fan.id), {});
  assert.equal((await store.history(fan.id)).length, 0);
  assert.deepEqual(await store.startSignIn("fan@example.com", now + 7200_000), { ok: false, reason: "not-invited" });

  // An invite for someone who already has an account adds the credits straight away.
  const r = await store.invite("owner@example.com", { credits: 25 }, now);
  assert.equal(r?.existing, true);
  assert.equal((await store.getUser(ownerUser.id))!.credits, store.OWNER_START_CREDITS + 25);

  // ---- used credits are counted for the owner's page ----
  const counter = (await store.invite("counter@example.com", { credits: 100 }, now))!;
  assert.ok(counter);
  const cc = (await store.startSignIn("counter@example.com", now)) as { code: string };
  const cu = ((await store.finishSignIn("counter@example.com", cc.code, now)) as { user: store.User }).user;
  await store.chargeStep(cu.id, 30, "Video");
  await store.recordCharge("req-counter-1", { userId: cu.id, credits: 30, what: "Video", at: now });
  await store.chargeStep(cu.id, 10, "Picture");
  await store.refundCharge("req-counter-1", cu.id, "failed");
  assert.equal((await store.getUser(cu.id))!.used, 10, "failed jobs don't count as used");

  // ---- sharing reward ----
  async function join(email: string, at = now, founding = true) {
    await store.invite(email, { founding }, at);
    const c = (await store.startSignIn(email, at)) as { code: string };
    const u = ((await store.finishSignIn(email, c.code, at)) as { user: store.User }).user;
    await refs.settleReferrals(u, at);
    return (await store.getUser(u.id))!;
  }
  const aliceCode = (await refs.refCodeFor("alice@gmail.com", now))!;
  assert.match(aliceCode, /^[A-Za-z0-9]{8}$/);
  assert.equal(await refs.refCodeFor("Alice@Gmail.com", now), aliceCode, "one link per person");
  assert.equal(await refs.recordReferral(aliceCode, "a.lice+2@gmail.com", now), "self", "your own second address doesn't count");
  assert.equal(await refs.recordReferral(aliceCode, "x@mailinator.com", now), "throwaway");
  assert.equal(await refs.recordReferral("nope1234", "bob@example.com", now), "no-code");
  assert.equal(await refs.recordReferral(aliceCode, "owner@example.com", now), "has-account");
  assert.equal(await refs.recordReferral(aliceCode, "bob@example.com", now), "recorded");
  const otherCode = (await refs.refCodeFor("carol@example.com", now))!;
  assert.equal(await refs.recordReferral(otherCode, "bob@example.com", now), "already", "the first link wins");

  // Bob gets an account first: nothing yet, Alice has no account.
  const bob = await join("bob@example.com");
  assert.equal(bob.credits, 500);
  // Alice joins: both get the bonus, once.
  const alice = await join("alice@gmail.com");
  assert.equal(alice.credits, 600);
  assert.equal((await store.getUser(bob.id))!.credits, 600);
  assert.equal((await store.getUser(bob.id))!.bonus, 100);
  assert.equal(await refs.settleReferrals(alice, now), 0, "only once");
  assert.equal(await refs.settleReferrals(bob, now), 0, "only once");

  // Up to 5 friends.
  for (let i = 1; i <= 6; i++) assert.equal(await refs.recordReferral(aliceCode, `friend${i}@example.com`, now), "recorded");
  for (let i = 1; i <= 6; i++) await join(`friend${i}@example.com`);
  assert.equal((await store.getUser(alice.id))!.credits, 500 + 5 * 100, "five bonuses at most");
  assert.equal((await store.findUserByEmail("friend4@example.com"))!.credits, 600, "Bob plus friends 1 to 4 make five");
  assert.equal((await store.findUserByEmail("friend5@example.com"))!.credits, 500, "the sixth friend joins without a bonus");
  assert.equal((await store.findUserByEmail("friend6@example.com"))!.credits, 500);
  const sum = await refs.referralSummary("alice@gmail.com");
  assert.deepEqual({ joined: sum.joined, credited: sum.credited, waiting: sum.waiting }, { joined: 7, credited: 5, waiting: 0 });

  // Deleting an account removes its link and who-invited-whom.
  await refs.forgetReferrals("bob@example.com");
  assert.equal((await refs.listReferrals()).some((r) => r.friend === "bob@example.com"), false);
  await refs.forgetReferrals("alice@gmail.com");
  assert.equal(await refs.emailForCode(aliceCode), null);
  assert.ok((await refs.listReferrals()).every((r) => r.by !== "alice@gmail.com"));

  // ---- the free month ending: a message first, then the Free plan, never a charge ----
  const dan = await join("dan@example.com", now);
  assert.equal(dan.planUntil, "2026-12-24");
  assert.equal(store.foundingStage(dan, now)?.stage, "active");
  const soon = Date.UTC(2026, 11, 21, 12);
  assert.deepEqual(store.foundingStage(dan, soon), { stage: "ending-soon", endsOn: "2026-12-24", daysLeft: 3 });
  // Uses most of the credits.
  await store.chargeStep(dan.id, 480, "Lots of videos");
  const after = Date.UTC(2026, 11, 24, 1);
  const moved = await store.applyPlanChanges((await store.getUser(dan.id))!, after);
  assert.equal(moved.plan, "free");
  assert.equal(moved.foundingEnded, "2026-12-24");
  assert.equal(moved.credits, 50, "topped up to the Free plan's 50");
  assert.equal(store.foundingStage(moved, after)?.stage, "ended");
  const again2 = await store.applyPlanChanges(moved, after + 3600_000);
  assert.equal(again2.credits, 50, "only once a month");
  const nextMonth = await store.applyPlanChanges(again2, Date.UTC(2027, 0, 2));
  assert.equal(nextMonth.credits, 50);
  await store.chargeStep(dan.id, 45, "Pictures");
  assert.equal((await store.applyPlanChanges((await store.getUser(dan.id))!, Date.UTC(2027, 1, 1))).credits, 50);
  // Someone with credits left keeps them.
  const erin = await join("erin@example.com", now);
  assert.equal((await store.applyPlanChanges(erin, after)).credits, 500);

  // ---- the daily job's key ----
  assert.ok(isCronKey(cronKey()));
  assert.ok(!isCronKey("nope") && !isCronKey(null));
  assert.ok(isCronPath("/api/cron/founding") && !isCronPath("/api/cron/other") && !isPublicPath("/api/cron/founding"));

  console.log("accounts tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
