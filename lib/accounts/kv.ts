import "server-only";
import { safeGetJSON, safeGetJSONWithEtag } from "../blobsSafe";

// Where accounts are kept: Netlify Blobs, built into every Netlify site (no
// extra database account). Reads are "strong", so a change is seen at once.
// Writes can be conditional ("only if nobody changed it since I read it"), which
// keeps credit balances right when two jobs finish at the same moment.
// Outside Netlify (a local test run) everything is kept in memory instead.

export type Versioned<T> = { value: T; etag: string } | null;

export type KV = {
  get<T>(key: string): Promise<T | null>;
  getVersioned<T>(key: string): Promise<Versioned<T>>;
  /** Returns false when the condition failed (someone else changed it first). */
  set(key: string, value: unknown, cond?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
};

export function memoryKV(): KV {
  const map = new Map<string, { json: string; etag: string }>();
  let n = 0;
  return {
    async get<T>(key: string) {
      const e = map.get(key);
      return e ? (JSON.parse(e.json) as T) : null;
    },
    async getVersioned<T>(key: string) {
      const e = map.get(key);
      return e ? { value: JSON.parse(e.json) as T, etag: e.etag } : null;
    },
    async set(key, value, cond) {
      const cur = map.get(key);
      if (cond?.onlyIfNew && cur) return false;
      if (cond?.onlyIfMatch !== undefined && cur?.etag !== cond.onlyIfMatch) return false;
      map.set(key, { json: JSON.stringify(value), etag: `m${++n}` });
      return true;
    },
    async delete(key) {
      map.delete(key);
    },
    async keys(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

// Kept on globalThis so every part of the server shares one store, even when
// the framework loads this file more than once.
const g = globalThis as unknown as { __tfKV?: KV | null };

/** For tests: start from an empty in-memory store. */
export function useMemoryKV(): KV {
  g.__tfKV = memoryKV();
  return g.__tfKV;
}

export async function kv(): Promise<KV> {
  if (g.__tfKV) return g.__tfKV;
  let cached: KV;
  try {
    const { getStore } = await import("@netlify/blobs");
    const blobs = getStore({ name: "accounts", consistency: "strong" });
    cached = {
      get: (key) => safeGetJSON(blobs, key),
      async getVersioned<T>(key: string) {
        const r = await safeGetJSONWithEtag<T>(blobs, key);
        return r ? { value: r.data, etag: r.etag } : null;
      },
      async set(key, value, cond) {
        const opts = cond?.onlyIfNew ? { onlyIfNew: true } : cond?.onlyIfMatch !== undefined ? { onlyIfMatch: cond.onlyIfMatch } : {};
        const r = await blobs.setJSON(key, value, opts);
        return r?.modified !== false;
      },
      delete: (key) => blobs.delete(key),
      async keys(prefix) {
        return (await blobs.list({ prefix })).blobs.map((b) => b.key).sort();
      },
    };
  } catch {
    cached = memoryKV(); // not on Netlify
  }
  g.__tfKV = cached;
  return cached;
}
