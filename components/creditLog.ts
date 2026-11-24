// The browser's record of credits used and returned under the promise.
// Without accounts, this record is all there is. With accounts on, the real
// balance lives on the server: each AI step is charged there as it starts and
// failed steps are given back there. This record still decides when the
// promise applies, and tells the server, which keeps its own limits (once per
// job, 10 a month, never more than was charged).

import { alreadyReturned, usedInMonth, type CreditEntry, type FaultCode } from "@/lib/promise";

const KEY = "genstudio.credits.v1";
const MAX = 500;

let accountMode = false;
let serverUsed = 0;
/** Called by the account wrapper when someone is signed in. */
export function setAccountMode(on: boolean) {
  accountMode = on;
}
export function setServerPromiseUsed(n: number) {
  serverUsed = Math.max(0, Number(n) || 0);
}

function tellServer(body: Record<string, unknown>) {
  if (!accountMode) return;
  fetch("/api/me/promise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .then((d) => {
      if (d?.ok) serverUsed += 1;
    })
    .catch(() => {});
}

export function readLog(): CreditEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as CreditEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: CreditEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    // A full or blocked storage never stops a job.
  }
}

export function logUsed(itemId: string, credits: number, what: string) {
  if (credits <= 0) return;
  write([...readLog(), { at: Date.now(), itemId, type: "used", credits, what }]);
}

/** Returns the credits for a job (or part of it, such as one ad scene) once. Returns false if they were already returned. */
export function logReturned(itemId: string, fault: FaultCode, what: string, part?: number): boolean {
  const list = readLog();
  if (alreadyReturned(list, itemId)) return false;
  const all = list.filter((e) => e.itemId === itemId && e.type === "used").reduce((n, e) => n + e.credits, 0);
  const credits = part === undefined ? all : Math.min(part, all);
  write([...list, { at: Date.now(), itemId, type: "returned", credits, what, fault }]);
  if (fault !== "failed") tellServer({ itemId, kind: "refund", credits, fault, what }); // failed jobs are given back by the server itself
  return true;
}

export function logFreeRemake(itemId: string, what: string) {
  write([...readLog(), { at: Date.now(), itemId, type: "free_remake", credits: 0, what }]);
  // With accounts, the remake is charged like any job, so the server gives back what the first try cost.
  const credits = readLog().filter((e) => e.itemId === itemId && e.type === "used").reduce((n, e) => n + e.credits, 0);
  tellServer({ itemId, kind: "free_remake", credits, what });
}

export function usedThisMonth(): number {
  const here = usedInMonth(readLog(), Date.now());
  return accountMode ? Math.max(here, serverUsed) : here;
}
