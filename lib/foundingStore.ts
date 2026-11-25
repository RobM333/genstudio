import "server-only";
import { createHash } from "node:crypto";
import { MAX_PER_IP_PER_DAY, type FoundingSignup } from "./founding";
import { safeGetJSON } from "./blobsSafe";

// Where founding sign-ups are kept: Netlify Blobs, which every Netlify site
// has built in (no extra account or secret). When running on a computer
// outside Netlify, sign-ups are kept in memory so the page can be tried.

type Store = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  keys(prefix: string): Promise<string[]>;
};

const memory = new Map<string, unknown>();
const memoryStore: Store = {
  async get(key) {
    return memory.get(key) ?? null;
  },
  async set(key, value) {
    memory.set(key, value);
  },
  async keys(prefix) {
    return [...memory.keys()].filter((k) => k.startsWith(prefix));
  },
};

let cached: Store | null = null;

async function store(): Promise<Store> {
  if (cached) return cached;
  try {
    const { getStore } = await import("@netlify/blobs");
    const blobs = getStore({ name: "founding", consistency: "strong" });
    cached = {
      get: (key) => safeGetJSON(blobs, key),
      set: async (key, value) => {
        await blobs.setJSON(key, value);
      },
      keys: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
    };
  } catch {
    cached = memoryStore; // not on Netlify (for example a local test run)
  }
  return cached;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** How many people have claimed a founding spot. */
export async function countSignups(): Promise<number> {
  return (await (await store()).keys("signup/")).length;
}

export type AddResult = "added" | "already" | "too-many";

/** Saves a sign-up once per email. The connection's address is only kept as a scrambled daily count. */
export async function addSignup(signup: FoundingSignup, ip: string): Promise<AddResult> {
  const s = await store();
  const key = `signup/${hash(signup.email)}`;
  if (await s.get(key)) return "already";

  const day = signup.at.slice(0, 10);
  const ipKey = `ip/${day}/${hash(`${day}:${ip}`)}`;
  const used = Number((await s.get(ipKey)) ?? 0) || 0;
  if (used >= MAX_PER_IP_PER_DAY) return "too-many";

  await s.set(key, signup);
  await s.set(ipKey, used + 1);
  return "added";
}

/** Has this person already been sent the "Founding 100 is full" message? */
export async function fullMessageSent(email: string): Promise<boolean> {
  return Boolean(await (await store()).get(`fullmsg/${hash(email)}`));
}

/** Remembers that the "Founding 100 is full" message went to this person, so nobody gets it twice. */
export async function markFullMessageSent(email: string): Promise<void> {
  await (await store()).set(`fullmsg/${hash(email)}`, { at: new Date().toISOString() });
}

/** Everyone who has been sent the "full" message, as scrambled keys (for the owner page). */
export async function fullMessageKeys(): Promise<Set<string>> {
  return new Set((await (await store()).keys("fullmsg/")).map((k) => k.slice("fullmsg/".length)));
}

export const emailHash = (email: string) => hash(email);

/** Every sign-up, oldest first, for the owner's download. */
export async function listSignups(): Promise<FoundingSignup[]> {
  const s = await store();
  const keys = await s.keys("signup/");
  const rows = (await Promise.all(keys.map((k) => s.get(k)))) as (FoundingSignup | null)[];
  return rows.filter((r): r is FoundingSignup => !!r && typeof r.email === "string").sort((a, b) => a.at.localeCompare(b.at));
}
