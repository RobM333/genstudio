import "server-only";
import type { Store } from "@netlify/blobs";

// Reading a key that doesn't exist yet hangs on the live site: Netlify answers
// "not found", and the blobs library then waits forever while throwing away the
// empty answer (checked on a deploy preview on 2026-11-25: a missing key never
// came back, while a "does it exist?" check came back in under 50 ms).
// So we ask "does it exist?" first, and only read keys that are there. The
// read also has a time limit, so one stuck request can't freeze sign-in.

const READ_LIMIT_MS = 8000;

function withLimit<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Storage read timed out (${what})`)), READ_LIMIT_MS);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

export async function safeGetJSON<T>(blobs: Store, key: string): Promise<T | null> {
  const meta = await withLimit(blobs.getMetadata(key), key);
  if (!meta) return null;
  return (await withLimit(blobs.get(key, { type: "json" }), key)) as T | null;
}

export async function safeGetJSONWithEtag<T>(blobs: Store, key: string): Promise<{ data: T; etag: string } | null> {
  const meta = await withLimit(blobs.getMetadata(key), key);
  if (!meta) return null;
  const r = await withLimit(blobs.getWithMetadata(key, { type: "json" }), key);
  return r ? { data: r.data as T, etag: String(r.etag ?? "") } : null;
}
