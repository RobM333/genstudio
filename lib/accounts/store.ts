import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import { kv, type KV } from "./kv";
import { authSecret } from "./session";
import { isAdminEmail } from "./config";
import { cleanEmail, OFFER } from "../founding";
import { monthKey, MONTHLY_CAP, type FaultCode } from "../promise";

// Everything an account keeps, and the few things that change it. Credits only
// ever change through changeCredits(), which writes a line in the person's
// credit history too, so Stripe top-ups can be added later as one more kind of line.

export type PlanId = "free" | "creator" | "pro" | "studio";

export type User = {
  id: string;
  email: string;
  name?: string;
  createdAt: number;
  lastSignIn?: number;
  /** The balance, to one decimal place. Shown rounded down. */
  credits: number;
  plan: PlanId;
  /** When a free month (the Founding offer) ends, e.g. 2026-12-24. */
  planUntil?: string;
  founding?: boolean;
  admin?: boolean;
  /** Bumped to sign the person out on every device. */
  sv: number;
  /** Their own voice copy for "You, talking" (made only after their spoken consent). */
  voice?: { id: string; at: number };
  /** Voice copies the person deleted, kept only as ids so they can never be used again. */
  deletedVoices?: string[];
  /** Automatic refunds and free remakes under the promise this month. */
  promise?: { month: string; used: number };
  /** Credits spent on AI work so far, less what came back (for the owner's page). */
  used?: number;
  /** Bonus credits earned by sharing their invite link. */
  bonus?: number;
  /** Which group of invites they came in with (the owner invites in groups). */
  group?: number;
  /** The month (e.g. 2026-12) the Free plan's credits were last topped up. */
  freeMonth?: string;
  /** When their free Founding month ended and they moved to the Free plan. */
  foundingEnded?: string;
  /** The free month end date the founding price message was sent for. */
  reminderSent?: string;
};

export type Invite = {
  email: string;
  name?: string;
  credits: number;
  plan: PlanId;
  /** Months of the plan for free (the Founding offer is 1). */
  months?: number;
  founding?: boolean;
  /** Which group of invites this was part of. */
  group?: number;
  at: number;
  /** Set when the person first signs in and the invite's credits are added. */
  usedAt?: number;
};

export type LedgerType = "grant" | "charge" | "refund" | "promise" | "admin" | "purchase";
export type LedgerEntry = { at: number; type: LedgerType; credits: number; balance: number; what: string; ref?: string };

export type Charge = { userId: string; credits: number; what: string; at: number; refunded?: number };

/** What the owner gets on first sign-in, so the studio can be used straight away. */
export const OWNER_START_CREDITS = 1000;
export const FREE_CREDITS = 50;
export const FOUNDING_CREDITS = 500;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_HOUR = 5;
/** Promise refunds are only for jobs charged in this window (checks run straight after a job). */
const PROMISE_WINDOW_MS = 6 * 3600_000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 40);
export const emailKey = (email: string) => sha(`email:${email}`);
const round1 = (n: number) => Math.round(n * 10) / 10;

async function store(): Promise<KV> {
  return kv();
}

// ---------- people ----------

export async function getUser(id: string): Promise<User | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
  return (await store()).get<User>(`user/${id}`);
}

export async function findUserByEmail(raw: string): Promise<User | null> {
  const email = cleanEmail(raw);
  if (!email) return null;
  const link = await (await store()).get<{ userId: string }>(`email/${emailKey(email)}`);
  return link ? getUser(link.userId) : null;
}

export async function getInvite(raw: string): Promise<Invite | null> {
  const email = cleanEmail(raw);
  return email ? (await store()).get<Invite>(`invite/${emailKey(email)}`) : null;
}

/** Invite-only for now: the owner, anyone invited, and anyone who already has an account. */
export async function maySignIn(email: string): Promise<boolean> {
  if (isAdminEmail(email)) return true;
  if (await getInvite(email)) return true;
  return Boolean(await findUserByEmail(email));
}

/** Changes a stored record safely when two requests touch it at once. */
export async function updateRecord<T>(key: string, change: (v: T) => T | null): Promise<T | null> {
  const s = await store();
  for (let i = 0; i < 10; i++) {
    const cur = await s.getVersioned<T>(key);
    if (!cur) return null;
    const next = change(cur.value);
    if (next === null) return null;
    if (await s.set(key, next, { onlyIfMatch: cur.etag })) return next;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
  }
  throw new Error(`Busy: ${key}`);
}

export async function saveUser(id: string, change: (u: User) => User): Promise<User | null> {
  return updateRecord<User>(`user/${id}`, change);
}

function addMonths(at: number, months: number): string {
  const d = new Date(at);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Makes the account the first time someone signs in, adding their invite's credits. */
async function createUser(email: string, now: number): Promise<User> {
  const s = await store();
  const invite = await getInvite(email);
  const admin = isAdminEmail(email);
  const user: User = {
    id: randomBytes(12).toString("base64url"),
    email,
    name: invite?.name,
    createdAt: now,
    credits: 0,
    plan: invite?.plan ?? "free",
    planUntil: invite?.months ? addMonths(now, invite.months) : undefined,
    founding: invite?.founding || undefined,
    group: invite?.group,
    admin: admin || undefined,
    sv: 1,
    freeMonth: monthKey(now),
  };
  // Only one account per email, even if two sign-ins race.
  if (!(await s.set(`email/${emailKey(email)}`, { userId: user.id }, { onlyIfNew: true }))) {
    const existing = await findUserByEmail(email);
    if (existing) return existing;
  }
  await s.set(`user/${user.id}`, user);
  if (invite && !invite.usedAt) {
    await updateRecord<Invite>(`invite/${emailKey(email)}`, (i) => ({ ...i, usedAt: now }));
    if (invite.credits > 0)
      await changeCredits(user.id, invite.credits, "grant", invite.founding ? "Founding member: 1 month of Creator" : "Welcome credits", undefined, now);
  }
  if (admin) await changeCredits(user.id, OWNER_START_CREDITS, "grant", "Owner's starting credits", undefined, now);
  return (await getUser(user.id)) ?? user;
}

// ---------- sign-in codes ----------

export type CodeRequest = { ok: true; code: string } | { ok: false; reason: "not-invited" | "too-many" | "bad-email" };

/** A fresh 6-digit code for this email. Only a scrambled copy is stored, for 10 minutes. */
export async function startSignIn(raw: string, now = Date.now()): Promise<CodeRequest> {
  const email = cleanEmail(raw);
  if (!email) return { ok: false, reason: "bad-email" };
  if (!(await maySignIn(email))) return { ok: false, reason: "not-invited" };
  const s = await store();
  const hourKey = `codes-sent/${emailKey(email)}/${Math.floor(now / 3600_000)}`;
  const sent = Number(await s.get<number>(hourKey)) || 0;
  if (sent >= CODES_PER_HOUR) return { ok: false, reason: "too-many" };
  await s.set(hourKey, sent + 1);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await s.set(`code/${emailKey(email)}`, { hash: sha(`${authSecret()}:${email}:${code}`), expires: now + CODE_MINUTES * 60_000, tries: 0 });
  return { ok: true, code };
}

export type CodeCheck = { ok: true; user: User } | { ok: false; reason: "wrong" | "expired" | "not-invited" };

/** Checks the code. Five wrong tries and it stops working. */
export async function finishSignIn(raw: string, code: string, now = Date.now()): Promise<CodeCheck> {
  const email = cleanEmail(raw);
  if (!email) return { ok: false, reason: "wrong" };
  const s = await store();
  const key = `code/${emailKey(email)}`;
  const saved = await s.get<{ hash: string; expires: number; tries: number }>(key);
  if (!saved || saved.expires < now || saved.tries >= CODE_TRIES) return { ok: false, reason: "expired" };
  if (saved.hash !== sha(`${authSecret()}:${email}:${String(code).replace(/\D/g, "")}`)) {
    await updateRecord<{ hash: string; expires: number; tries: number }>(key, (c) => ({ ...c, tries: c.tries + 1 }));
    return { ok: false, reason: "wrong" };
  }
  await s.delete(key);
  if (!(await maySignIn(email))) return { ok: false, reason: "not-invited" };
  const user = (await findUserByEmail(email)) ?? (await createUser(email, now));
  const signedIn = await saveUser(user.id, (u) => ({ ...u, lastSignIn: now, admin: isAdminEmail(u.email) || undefined }));
  return { ok: true, user: signedIn ?? user };
}

// ---------- credits ----------

export type CreditChange = { ok: true; user: User } | { ok: false; reason: "not-enough" | "no-account"; balance?: number };

/** Adds (or, when negative, takes) credits and writes a line in the person's history. */
export async function changeCredits(userId: string, delta: number, type: LedgerType, what: string, ref?: string, now = Date.now()): Promise<CreditChange> {
  const d = round1(delta);
  let short: number | undefined;
  const user = await saveUser(userId, (u) => {
    const next = round1((u.credits || 0) + d);
    if (d < 0 && next < 0) {
      short = u.credits;
      return null as unknown as User;
    }
    // Spending counts up; credits given back for a job count it down again.
    const spent = type === "charge" ? -d : type === "refund" || type === "promise" ? -d : 0;
    return { ...u, credits: next, used: spent ? Math.max(0, round1((u.used ?? 0) + spent)) : u.used };
  }).catch(() => null);
  if (!user) return short !== undefined ? { ok: false, reason: "not-enough", balance: short } : { ok: false, reason: "no-account" };
  const entry: LedgerEntry = { at: now, type, credits: d, balance: user.credits, what: what.slice(0, 160), ref };
  await (await store()).set(`ledger/${userId}/${String(now).padStart(15, "0")}-${randomBytes(3).toString("hex")}`, entry);
  return { ok: true, user };
}

/** Takes the credits for one AI step before it starts. */
export async function chargeStep(userId: string, credits: number, what: string): Promise<CreditChange> {
  if (credits <= 0) {
    const u = await getUser(userId);
    return u ? { ok: true, user: u } : { ok: false, reason: "no-account" };
  }
  return changeCredits(userId, -credits, "charge", what);
}

/** Remembers which account paid for a started job, so a failure can give the credits back. */
export async function recordCharge(requestId: string, c: Charge) {
  if (c.credits > 0 && requestId) await (await store()).set(`charge/${requestId}`, c);
}

/** A job failed: its credits go back to whoever paid, once. */
export async function refundCharge(requestId: string, userId: string | null, why: string): Promise<number> {
  if (!/^[\w-]{8,100}$/.test(requestId)) return 0;
  const s = await store();
  const cur = await s.getVersioned<Charge>(`charge/${requestId}`);
  if (!cur || cur.value.refunded || (userId && cur.value.userId !== userId)) return 0;
  if (!(await s.set(`charge/${requestId}`, { ...cur.value, refunded: Date.now() }, { onlyIfMatch: cur.etag }))) return 0;
  const r = await changeCredits(cur.value.userId, cur.value.credits, "refund", `Given back: ${why}`.slice(0, 160), requestId);
  return r.ok ? cur.value.credits : 0;
}

export async function history(userId: string, limit = 50): Promise<LedgerEntry[]> {
  const s = await store();
  const keys = (await s.keys(`ledger/${userId}/`)).slice(-limit).reverse();
  return (await Promise.all(keys.map((k) => s.get<LedgerEntry>(k)))).filter((e): e is LedgerEntry => !!e);
}

export type PromiseResult = { ok: true; credits: number; user: User } | { ok: false; reason: "capped" | "already" | "nothing" };

/**
 * The "no wasted credits" promise on the server: credits come back for a job
 * our check found a clear fault in (or a free remake is counted), at most
 * MONTHLY_CAP times a month, once per job, and never more than the person was
 * charged in the last few hours.
 */
export async function promiseAction(
  userId: string,
  opts: { itemId: string; kind: "refund" | "free_remake"; credits?: number; fault?: FaultCode; what: string },
  now = Date.now(),
): Promise<PromiseResult> {
  const s = await store();
  const itemId = opts.itemId.replace(/[^\w-]/g, "").slice(0, 80);
  if (!itemId) return { ok: false, reason: "nothing" };
  const month = monthKey(now);
  // Count it against this month's limit first, so two at once can't both slip under it.
  let capped = false;
  const counted = await saveUser(userId, (u) => {
    const used = u.promise?.month === month ? u.promise.used : 0;
    if (used >= MONTHLY_CAP) {
      capped = true;
      return null as unknown as User;
    }
    return { ...u, promise: { month, used: used + 1 } };
  }).catch(() => null);
  if (!counted) return { ok: false, reason: capped ? "capped" : "nothing" };
  const undo = () => saveUser(userId, (u) => ({ ...u, promise: { month, used: Math.max(0, (u.promise?.month === month ? u.promise.used : 1) - 1) } }));

  if (!(await s.set(`promise/${userId}/${itemId}${opts.kind === "free_remake" ? "-remake" : ""}`, { at: now, ...opts }, { onlyIfNew: true }))) {
    await undo();
    return { ok: false, reason: "already" };
  }
  // A free remake is charged like any job when it runs, so what the first try cost comes back now.
  // Never more than was actually charged recently, less what the promise already gave back.
  const recent = (await history(userId, 300)).filter((e) => now - e.at < PROMISE_WINDOW_MS);
  const charged = -recent.filter((e) => e.type === "charge").reduce((n, e) => n + e.credits, 0);
  const given = recent.filter((e) => e.type === "promise" || e.type === "refund").reduce((n, e) => n + e.credits, 0);
  const credits = round1(Math.min(Math.max(0, Number(opts.credits) || 0), Math.max(0, charged - given)));
  if (credits <= 0) {
    await undo();
    return { ok: false, reason: "nothing" };
  }
  const label = opts.kind === "free_remake" ? `No wasted credits: a free remake (${opts.what})` : `No wasted credits: ${opts.what}`;
  const r = await changeCredits(userId, credits, "promise", label.slice(0, 160), itemId, now);
  return r.ok ? { ok: true, credits, user: r.user } : { ok: false, reason: "nothing" };
}

// ---------- the free Founding month ending, and the Free plan ----------

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

export type FoundingStage = "active" | "ending-soon" | "ended";

/** Where a founding member is in their free month. Null for everyone else. */
export function foundingStage(u: User, now = Date.now()): { stage: FoundingStage; endsOn: string; daysLeft: number } | null {
  if (u.foundingEnded) return { stage: "ended", endsOn: u.foundingEnded, daysLeft: 0 };
  if (!u.founding || !u.planUntil) return null;
  const daysLeft = Math.ceil((Date.parse(`${u.planUntil}T00:00:00Z`) - now) / 86400_000);
  if (daysLeft <= 0) return { stage: "ended", endsOn: u.planUntil, daysLeft: 0 };
  return { stage: daysLeft <= OFFER.reminderDays ? "ending-soon" : "active", endsOn: u.planUntil, daysLeft };
}

/**
 * Keeps the plan right, run whenever the account is read. Nobody is ever
 * charged here (payments aren't built): when a free month ends the person moves
 * to the Free plan and keeps their saved work and any credits left. On the Free
 * plan the balance is topped up to 50 at the start of each month (unused Free
 * credits don't pile up).
 */
export async function applyPlanChanges(user: User, now = Date.now()): Promise<User> {
  if (user.admin) return user;
  const month = monthKey(now);
  const ended = Boolean(user.planUntil && user.plan !== "free" && user.planUntil <= today(now));
  const freeTopUp = (ended || user.plan === "free") && user.freeMonth !== month;
  if (!ended && !freeTopUp) return user;
  let topUp = 0;
  const next = await saveUser(user.id, (u) => {
    const endNow = Boolean(u.planUntil && u.plan !== "free" && u.planUntil <= today(now));
    const isFree = endNow || u.plan === "free";
    if (!endNow && !(isFree && u.freeMonth !== month)) return null as unknown as User;
    topUp = endNow || u.freeMonth !== month ? Math.max(0, round1(OFFER.afterCredits - (u.credits || 0))) : 0;
    const out: User = { ...u, freeMonth: isFree ? month : u.freeMonth };
    if (endNow) {
      out.plan = "free";
      out.foundingEnded = u.founding ? u.planUntil : undefined;
      out.planUntil = undefined;
    }
    return out;
  }).catch(() => null);
  if (!next) return (await getUser(user.id)) ?? user;
  if (topUp > 0) {
    const r = await changeCredits(user.id, topUp, "grant", `Free plan: topped up to ${OFFER.afterCredits} credits for the month`, undefined, now);
    if (r.ok) return r.user;
  }
  return next;
}

// ---------- invites (the owner's page) ----------

export async function invite(rawEmail: string, opts: { name?: string; founding?: boolean; credits?: number; group?: number }, now = Date.now()): Promise<{ invite: Invite; existing: boolean } | null> {
  const email = cleanEmail(rawEmail);
  if (!email) return null;
  const s = await store();
  const founding = Boolean(opts.founding);
  const inv: Invite = {
    email,
    name: opts.name?.slice(0, 80) || undefined,
    credits: founding ? FOUNDING_CREDITS : Math.max(0, Math.min(10000, Math.round(Number(opts.credits ?? FREE_CREDITS)))),
    plan: founding ? "creator" : "free",
    months: founding ? 1 : undefined,
    founding: founding || undefined,
    group: opts.group && opts.group > 0 && opts.group < 1000 ? Math.floor(opts.group) : undefined,
    at: now,
  };
  const before = await getInvite(email);
  const user = await findUserByEmail(email);
  if (user) {
    // Already has an account: add the offer straight away (only once for the Founding offer).
    if (founding && user.founding) return { invite: { ...inv, usedAt: before?.usedAt ?? user.createdAt }, existing: true };
    await saveUser(user.id, (u) => ({
      ...u,
      plan: founding ? "creator" : u.plan,
      planUntil: founding ? addMonths(now, 1) : u.planUntil,
      founding: founding || u.founding,
      group: u.group ?? inv.group,
    }));
    if (inv.credits > 0) await changeCredits(user.id, inv.credits, "grant", founding ? "Founding member: 1 month of Creator" : "Credits from ToastyFly", undefined, now);
    inv.usedAt = now;
    await s.set(`invite/${emailKey(email)}`, inv);
    return { invite: inv, existing: true };
  }
  if (before?.usedAt) inv.usedAt = before.usedAt;
  await s.set(`invite/${emailKey(email)}`, inv);
  return { invite: inv, existing: false };
}

export async function listInvites(): Promise<Invite[]> {
  const s = await store();
  const keys = await s.keys("invite/");
  return (await Promise.all(keys.map((k) => s.get<Invite>(k)))).filter((i): i is Invite => !!i).sort((a, b) => b.at - a.at);
}

export async function listUsers(): Promise<User[]> {
  const s = await store();
  const keys = await s.keys("user/");
  return (await Promise.all(keys.map((k) => s.get<User>(k)))).filter((u): u is User => !!u).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- saved work (gallery, Brand kit and the rest) ----------

/** The parts of the studio saved to the account. The ElevenLabs connection holds a key, so it is stored encrypted. */
export const DATA_NAMES = ["gallery", "chat", "brand", "refs", "ideas", "talk", "elevenlabs", "film"] as const;
export type DataName = (typeof DATA_NAMES)[number];
const SECRET_DATA: DataName[] = ["elevenlabs"];
export const MAX_DATA_BYTES = 1_500_000;

export function isDataName(n: unknown): n is DataName {
  return typeof n === "string" && (DATA_NAMES as readonly string[]).includes(n);
}

function dataKey(): Buffer {
  return createHash("sha256").update(`${authSecret()}|account-data`).digest();
}

export function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dataKey(), iv);
  const out = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${out.toString("base64url")}`;
}

export function unseal(sealed: string): string | null {
  try {
    const [v, iv, tag, body] = sealed.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Everything saved for this person, as the text the browser keeps. */
export async function readData(userId: string): Promise<Partial<Record<DataName, string>>> {
  const s = await store();
  const out: Partial<Record<DataName, string>> = {};
  await Promise.all(
    DATA_NAMES.map(async (n) => {
      const v = await s.get<{ text?: string; sealed?: string }>(`data/${userId}/${n}`);
      const text = v?.sealed ? unseal(v.sealed) : v?.text;
      if (typeof text === "string") out[n] = text;
    }),
  );
  return out;
}

export async function writeData(userId: string, name: DataName, text: string | null): Promise<boolean> {
  const s = await store();
  if (text === null) {
    await s.delete(`data/${userId}/${name}`);
    return true;
  }
  if (text.length > MAX_DATA_BYTES) return false;
  await s.set(`data/${userId}/${name}`, SECRET_DATA.includes(name) ? { sealed: seal(text), at: Date.now() } : { text, at: Date.now() });
  return true;
}

// ---------- voice copy and deleting ----------

export async function setVoice(userId: string, voiceId: string, now = Date.now()) {
  await saveUser(userId, (u) => ({ ...u, voice: { id: voiceId, at: now } }));
}

/** Deletes the voice copy from the account, so it can never be used again, and the saved link to it. */
export async function deleteVoice(userId: string) {
  await saveUser(userId, (u) => {
    const { voice, ...rest } = u;
    return { ...rest, deletedVoices: [...(u.deletedVoices ?? []), ...(voice ? [voice.id] : [])].slice(-20) } as User;
  });
  const talk = (await readData(userId)).talk;
  if (talk) {
    try {
      const t = JSON.parse(talk) as { voice?: unknown };
      delete t.voice;
      await writeData(userId, "talk", JSON.stringify(t));
    } catch {
      await writeData(userId, "talk", null);
    }
  }
}

/** Deletes the account and everything saved with it. The invite goes too, so the email is no longer kept. */
export async function deleteAccount(userId: string): Promise<boolean> {
  const user = await getUser(userId);
  if (!user) return false;
  const s = await store();
  const keys = [
    ...(await s.keys(`data/${userId}/`)),
    ...(await s.keys(`ledger/${userId}/`)),
    ...(await s.keys(`promise/${userId}/`)),
    `email/${emailKey(user.email)}`,
    `invite/${emailKey(user.email)}`,
    `code/${emailKey(user.email)}`,
    `user/${userId}`,
  ];
  for (const k of keys) await s.delete(k);
  return true;
}
