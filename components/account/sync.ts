"use client";

// Keeps the studio's saved work in the account. The studio itself keeps
// everything in this browser (as it always has). When someone is signed in,
// this copies those saved parts to their account and back, so their gallery,
// Brand kit, references and the rest follow them to any device, and a shared
// computer doesn't show one person's work to the next.

export const SYNCED: Record<string, string> = {
  gallery: "genstudio.gallery.v1",
  chat: "genstudio.chat.v1",
  brand: "genstudio.brand.v1",
  refs: "genstudio.refs.v1",
  ideas: "genstudio.ideas.v1",
  talk: "genstudio.talk.v1",
  elevenlabs: "genstudio.elevenlabs.v1",
  film: "genstudio.film.v1", // the Film Set form (saved characters live in the Brand kit)
};
/** Whose work this browser is holding. */
const OWNER = "toastyfly.account.owner";
/** Kept only on this device: the browser's own record of credits and the terms tick. */
const LOCAL_ONLY = ["genstudio.credits.v1"];

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // storage full or blocked
  }
};

/** Lists of things with ids (the gallery, references): keep both sides, the account's first. */
export function mergeLists(server: string, local: string): string {
  try {
    const a = JSON.parse(server);
    const b = JSON.parse(local);
    if (!Array.isArray(a) || !Array.isArray(b)) return server;
    const id = (x: unknown) => (x && typeof x === "object" && "id" in x ? String((x as { id: unknown }).id) : (x && typeof x === "object" && "url" in x ? String((x as { url: unknown }).url) : JSON.stringify(x)));
    const seen = new Set(a.map(id));
    return JSON.stringify([...a, ...b.filter((x) => !seen.has(id(x)))]);
  } catch {
    return server;
  }
}

/** Removes everyone's saved work from this browser (on sign-out, or when someone else signs in here). */
export function clearDevice() {
  for (const k of [...Object.values(SYNCED), ...LOCAL_ONLY, OWNER]) put(k, null);
}

async function push(name: string, text: string | null, keepalive = false): Promise<boolean> {
  try {
    const r = await fetch("/api/me/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, text }),
      keepalive: keepalive && (text?.length ?? 0) < 60000,
    });
    return r.ok || r.status === 413; // too big: skip it rather than retrying for ever
  } catch {
    return false;
  }
}

/**
 * Brings the account's saved work into this browser, then keeps sending
 * changes up every few seconds. Returns a function that stops it.
 */
export async function startSync(email: string): Promise<() => void> {
  const r = await fetch("/api/me/data", { cache: "no-store" });
  const server = r.ok ? (((await r.json()).data ?? {}) as Record<string, string>) : null;
  const last: Record<string, string | null> = {};
  if (server) {
    const owner = get(OWNER);
    if (owner && owner !== email) clearDevice();
    for (const [name, key] of Object.entries(SYNCED)) {
      const local = get(key);
      const saved = server[name];
      if (typeof saved === "string") {
        // First sign-in on this browser: keep what was made here before, alongside the account's.
        const next = !owner && local ? mergeLists(saved, local) : saved;
        put(key, next);
        last[name] = saved;
      } else {
        last[name] = null; // the loop below sends anything this browser has
      }
    }
    put(OWNER, email);
  } else {
    for (const [name, key] of Object.entries(SYNCED)) last[name] = get(key);
  }

  let busy = false;
  const tick = async (keepalive = false) => {
    if (busy) return;
    busy = true;
    try {
      for (const [name, key] of Object.entries(SYNCED)) {
        const now = get(key);
        if (now !== last[name] && (await push(name, now, keepalive))) last[name] = now;
      }
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 3000);
  const onHide = () => {
    if (document.visibilityState === "hidden") void tick(true);
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
    void tick(true);
  };
}

/** Sends anything not yet saved, now (before signing out). */
export async function flush() {
  for (const [name, key] of Object.entries(SYNCED)) await push(name, get(key));
}
