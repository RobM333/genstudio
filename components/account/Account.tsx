"use client";

// The signed-in person, for the studio. Loads their account and saved work
// before the studio opens, keeps the credit balance fresh, and sends anyone
// whose sign-in ran out back to the sign-in page.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clearDevice, flush, startSync } from "./sync";
import { setServerPromiseUsed, setAccountMode } from "../creditLog";

export type Me = {
  email: string;
  name: string;
  credits: number;
  plan: "free" | "creator" | "pro" | "studio";
  planUntil: string | null;
  founding: boolean;
  admin: boolean;
  voice: { at: number } | null;
  promiseUsed: number;
  createdAt: number;
};

type Ctx = { me: Me; refresh: () => void; signOut: () => Promise<void> };
const AccountCtx = createContext<Ctx | null>(null);

export function useAccount(): Ctx | null {
  return useContext(AccountCtx);
}

export const PLAN_NAMES: Record<Me["plan"], string> = { free: "Free", creator: "Creator", pro: "Pro", studio: "Studio" };

export async function signOut() {
  await flush().catch(() => {});
  await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
  clearDevice();
  window.location.href = "/signin?out=1";
}

function toSignIn() {
  const next = window.location.pathname + window.location.search;
  window.location.href = `/signin?next=${encodeURIComponent(next)}`;
}

/** Wraps the studio when accounts are on. Nothing shows until the account's saved work is in place. */
export function AccountGate({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const lastRefresh = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    lastRefresh.current = Date.now();
    const r = await fetch("/api/me", { cache: "no-store" }).catch(() => null);
    if (r?.status === 401) return toSignIn();
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (d?.user) {
      setMe(d.user);
      setServerPromiseUsed(d.user.promiseUsed ?? 0);
    }
    return d?.user as Me | undefined;
  }, []);

  const refresh = useCallback(() => {
    // At most one check every few seconds, however many jobs are running.
    if (pending.current) return;
    const wait = Math.max(600, 4000 - (Date.now() - lastRefresh.current));
    pending.current = setTimeout(() => {
      pending.current = null;
      void load();
    }, wait);
  }, [load]);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    setAccountMode(true);
    (async () => {
      const user = await load();
      if (!alive) return;
      if (!user) {
        setProblem("We couldn't load your account. Please check your connection and reload the page.");
        return;
      }
      stop = await startSync(user.email).catch(() => null);
      if (alive) setReady(true);
    })();

    // Every paid step changes the balance, and a 401 means the sign-in ran out.
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (/\/api\/(generate|tool|talk|status|me\/promise)/.test(url)) refresh();
      if (res.status === 401 && /\/api\/(?!auth\/)/.test(url)) {
        const body = await res.clone().json().catch(() => ({}));
        if (body?.signIn) toSignIn();
      }
      return res;
    };
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), 30000);
    return () => {
      alive = false;
      window.fetch = original;
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
      stop?.();
    };
  }, [load, refresh]);

  if (problem) return <div className="account-loading"><p>{problem}</p></div>;
  if (!ready || !me)
    return (
      <div className="account-loading">
        <span className="spinner small" aria-hidden />
        <p>Opening your studio…</p>
      </div>
    );
  return <AccountCtx.Provider value={{ me, refresh, signOut }}>{children}</AccountCtx.Provider>;
}
