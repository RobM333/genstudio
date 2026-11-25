import "server-only";
import { randomBytes } from "node:crypto";
import { kv } from "./kv";
import { changeCredits, emailKey, findUserByEmail, saveUser, updateRecord, type User } from "./store";
import { cleanEmail, cleanRefCode, inboxOf, isThrowawayEmail, REFERRAL } from "../founding";

// The sharing reward. Every founding sign-up (and every account) has a personal
// invite link. When a friend joins the waitlist through it, we remember who
// invited them. The credits are only added once both people have accounts (an
// account means the email was proved with a sign-in code), at most
// REFERRAL.maxFriends friends per person. Nothing here charges anyone.
//
// Kept in the same store as accounts:
//   refcode/{code}            -> { email }          whose link this is
//   refof/{inbox}             -> { code }           someone's link
//   referral/{friend inbox}   -> Referral           who invited this friend (the first link wins)
//   refby/{inbox}/{friend}    -> { at }             the friends someone invited
//   refcount/{inbox}          -> { credited }       how many friends earned the reward

export type ReferralState = "waiting" | "credited" | "over-cap";
export type Referral = { friend: string; by: string; at: number; state: ReferralState; creditedAt?: number };

const inboxKey = (email: string) => emailKey(inboxOf(email));
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function newCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/** This person's invite code, made the first time it is asked for. */
export async function refCodeFor(rawEmail: string, now = Date.now()): Promise<string | null> {
  const email = cleanEmail(rawEmail);
  if (!email) return null;
  const s = await kv();
  const mine = `refof/${inboxKey(email)}`;
  const have = await s.get<{ code: string }>(mine);
  if (have?.code) return have.code;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if (!(await s.set(`refcode/${code}`, { email, at: now }, { onlyIfNew: true }))) continue;
    if (await s.set(mine, { code }, { onlyIfNew: true })) return code;
    // Someone else made one at the same moment: use theirs.
    await s.delete(`refcode/${code}`);
    return (await s.get<{ code: string }>(mine))?.code ?? null;
  }
  return null;
}

export async function emailForCode(raw: unknown): Promise<string | null> {
  const code = cleanRefCode(raw);
  if (!code) return null;
  return (await (await kv()).get<{ email: string }>(`refcode/${code}`))?.email ?? null;
}

export type RecordResult = "recorded" | "no-code" | "self" | "throwaway" | "already" | "has-account";

/**
 * A new waitlist sign-up came through someone's link. Only called for a brand
 * new sign-up, so joining again with the same email doesn't count.
 */
export async function recordReferral(code: unknown, rawFriend: string, now = Date.now()): Promise<RecordResult> {
  const friend = cleanEmail(rawFriend);
  const by = await emailForCode(code);
  if (!friend || !by) return "no-code";
  if (inboxOf(friend) === inboxOf(by)) return "self";
  if (isThrowawayEmail(friend)) return "throwaway";
  if (await findUserByEmail(friend)) return "has-account";
  const s = await kv();
  const r: Referral = { friend, by, at: now, state: "waiting" };
  if (!(await s.set(`referral/${inboxKey(friend)}`, r, { onlyIfNew: true }))) return "already";
  await s.set(`refby/${inboxKey(by)}/${inboxKey(friend)}`, { at: now });
  return "recorded";
}

/** Gives both people the bonus for one friend, once, within the limit. */
async function credit(friendInboxKey: string, friend: User, referrer: User, now: number): Promise<boolean> {
  const s = await kv();
  const key = `referral/${friendInboxKey}`;
  const cur = await s.getVersioned<Referral>(key);
  if (!cur || cur.value.state !== "waiting") return false;
  // Only one sign-in gets to settle this friend.
  if (!(await s.set(key, { ...cur.value, state: "credited", creditedAt: now }, { onlyIfMatch: cur.etag }))) return false;

  const countKey = `refcount/${inboxKey(referrer.email)}`;
  await s.set(countKey, { credited: 0 }, { onlyIfNew: true });
  let over = false;
  await updateRecord<{ credited: number }>(countKey, (c) => {
    if (c.credited >= REFERRAL.maxFriends) {
      over = true;
      return null;
    }
    return { credited: c.credited + 1 };
  });
  if (over) {
    await s.set(key, { ...cur.value, state: "over-cap" });
    return false;
  }
  const n = REFERRAL.bonus;
  const ref = `referral:${friendInboxKey}`;
  for (const [who, what] of [
    [friend, `Joined with a friend's invite link: ${n} bonus credits`],
    [referrer, `A friend joined with your invite link: ${n} bonus credits`],
  ] as const) {
    const r = await changeCredits(who.id, n, "grant", what, ref, now);
    if (r.ok) await saveUser(who.id, (u) => ({ ...u, bonus: (u.bonus ?? 0) + n }));
  }
  return true;
}

/**
 * Run at every sign-in. Settles any rewards that were waiting for this person
 * to have an account: as the friend who was invited, and as the one who invited.
 * Returns how many bonuses were added.
 */
export async function settleReferrals(user: User, now = Date.now()): Promise<number> {
  const s = await kv();
  let n = 0;
  const mine = inboxKey(user.email);

  const asFriend = await s.get<Referral>(`referral/${mine}`);
  if (asFriend?.state === "waiting") {
    const referrer = await findUserByEmail(asFriend.by);
    if (referrer && referrer.id !== user.id && (await credit(mine, user, referrer, now))) n++;
  }

  for (const k of await s.keys(`refby/${mine}/`)) {
    const friendKey = k.slice(k.lastIndexOf("/") + 1);
    const r = await s.get<Referral>(`referral/${friendKey}`);
    if (r?.state !== "waiting") continue;
    const friend = await findUserByEmail(r.friend);
    if (friend && friend.id !== user.id && (await credit(friendKey, friend, user, now))) n++;
  }
  return n;
}

export type ReferralSummary = {
  code: string | null;
  /** Friends who joined through the link. */
  joined: number;
  /** Friends whose bonus has been added. */
  credited: number;
  /** Friends who joined and are waiting for their account (or yours). */
  waiting: number;
  max: number;
  bonus: number;
};

export async function referralSummary(email: string): Promise<ReferralSummary> {
  const s = await kv();
  const keys = await s.keys(`refby/${inboxKey(email)}/`);
  const rows = (await Promise.all(keys.map((k) => s.get<Referral>(`referral/${k.slice(k.lastIndexOf("/") + 1)}`)))).filter((r): r is Referral => !!r);
  return {
    code: await refCodeFor(email),
    joined: rows.length,
    credited: rows.filter((r) => r.state === "credited").length,
    waiting: rows.filter((r) => r.state === "waiting").length,
    max: REFERRAL.maxFriends,
    bonus: REFERRAL.bonus,
  };
}

/** Every referral, for the owner's page. */
export async function listReferrals(): Promise<Referral[]> {
  const s = await kv();
  const keys = await s.keys("referral/");
  return (await Promise.all(keys.map((k) => s.get<Referral>(k)))).filter((r): r is Referral => !!r);
}

/**
 * When someone deletes their account, their link and the record of who invited
 * them go too. A friend they invited keeps any bonus already added.
 */
export async function forgetReferrals(email: string): Promise<void> {
  const s = await kv();
  const mine = inboxKey(email);
  const code = (await s.get<{ code: string }>(`refof/${mine}`))?.code;
  const invited = await s.keys(`refby/${mine}/`);
  for (const k of invited) {
    const friendKey = `referral/${k.slice(k.lastIndexOf("/") + 1)}`;
    const r = await s.get<Referral>(friendKey);
    if (!r) continue;
    // A reward still waiting can't be paid any more; a paid one is kept without this person's email.
    if (r.state === "waiting") await s.delete(friendKey);
    else await s.set(friendKey, { ...r, by: "" });
  }
  const keys = [...invited, `refof/${mine}`, `referral/${mine}`, `refcount/${mine}`];
  if (code) keys.push(`refcode/${code}`);
  for (const k of keys) await s.delete(k);
}
