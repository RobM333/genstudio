import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  activeLessons,
  EMPTY_SETTINGS,
  KEEP_DAYS,
  NOTE_DAYS,
  type ActiveLesson,
  type FeedbackEvent,
  type LearnSettings,
  type LessonKind,
} from "./learn";

// Where "learn from every fix" keeps its reports and the owner's switches:
// Netlify Blobs, which every Netlify site has built in (no extra account or
// secret). Outside Netlify (a local test run) they are kept in memory.
//
// Each report is its own small record (key "ev/<day>/<random>"), so two people
// sending one at the same moment never overwrite each other. When accounts
// arrive, these move one-to-one into a "feedback" table and the switches into
// a "lessons" table.

type Store = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
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
  async del(key) {
    memory.delete(key);
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
    const blobs = getStore({ name: "learn", consistency: "strong" });
    cached = {
      get: (key) => blobs.get(key, { type: "json" }),
      set: async (key, value) => {
        await blobs.setJSON(key, value);
      },
      del: (key) => blobs.delete(key),
      keys: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
    };
  } catch {
    cached = memoryStore; // not on Netlify (for example a local test run)
  }
  return cached;
}

/** Scrambles the browser's random number, so reports can't be linked back to anything. */
export const scramble = (s: string) => createHash("sha256").update(`toastyfly-learn:${s}`).digest("hex").slice(0, 16);

/** Most reports we take from one browser in a day, so nobody can flood the counts. */
export const MAX_PER_DAY = 150;

export async function addEvent(e: FeedbackEvent): Promise<"added" | "too-many"> {
  const s = await store();
  const day = e.at.slice(0, 10);
  const rl = `rl/${day}/${e.who}`;
  const used = Number((await s.get(rl)) ?? 0) || 0;
  if (used >= MAX_PER_DAY) return "too-many";
  await s.set(rl, used + 1);
  await s.set(`ev/${day}/${randomUUID()}`, e);
  return "added";
}

/** Reports from the last `days` days. Deletes ones older than we keep, and old comments. */
export async function listEvents(days = KEEP_DAYS): Promise<FeedbackEvent[]> {
  const s = await store();
  const keys = await s.keys("ev/");
  const now = Date.now();
  const oldest = new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const from = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const noteBefore = new Date(now - NOTE_DAYS * 86_400_000).toISOString();
  const out: FeedbackEvent[] = [];
  await Promise.all(
    keys.map(async (k) => {
      const day = k.slice(3, 13);
      if (day < oldest) return s.del(k);
      if (day < from) return;
      const e = (await s.get(k)) as FeedbackEvent | null;
      if (!e || typeof e.at !== "string") return;
      if (e.note && e.at < noteBefore) {
        delete e.note;
        await s.set(k, e);
      }
      out.push(e);
    }),
  );
  // Old daily rate-limit counters aren't needed.
  const rlKeys = await s.keys("rl/");
  const today = new Date(now).toISOString().slice(0, 10);
  await Promise.all(rlKeys.filter((k) => k.slice(3, 13) < today).map((k) => s.del(k)));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------- The owner's switches ----------

let settingsCache: { at: number; value: LearnSettings } | null = null;
const SETTINGS_TTL = 60_000;

export async function getSettings(fresh = false): Promise<LearnSettings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL) return settingsCache.value;
  let value: LearnSettings = EMPTY_SETTINGS;
  try {
    const raw = (await (await store()).get("settings")) as Partial<LearnSettings> | null;
    if (raw) value = { rules: raw.rules ?? {}, custom: Array.isArray(raw.custom) ? raw.custom : [] };
  } catch {
    // keep the empty settings: no rules means the booster works exactly as before
  }
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(value: LearnSettings): Promise<void> {
  await (await store()).set("settings", value);
  settingsCache = { at: Date.now(), value };
}

/**
 * The rules to add for one new prompt. Never slows generation down or breaks
 * it: if the store can't be read in time, no rules are added.
 */
export async function lessonsFor(kind: LessonKind): Promise<ActiveLesson[]> {
  try {
    const settings = await Promise.race([
      getSettings(),
      new Promise<LearnSettings>((resolve) => setTimeout(() => resolve(EMPTY_SETTINGS), 1500)),
    ]);
    return activeLessons(settings, kind);
  } catch {
    return [];
  }
}
