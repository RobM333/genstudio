// The browser's record of credits used and returned under the promise.
// There are no accounts yet, so this is kept on this device. When accounts and
// credit balances arrive, these same entries are written on the server instead.

import { alreadyReturned, usedInMonth, type CreditEntry, type FaultCode } from "@/lib/promise";

const KEY = "genstudio.credits.v1";
const MAX = 500;

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
  return true;
}

export function logFreeRemake(itemId: string, what: string) {
  write([...readLog(), { at: Date.now(), itemId, type: "free_remake", credits: 0, what }]);
}

export function usedThisMonth(): number {
  return usedInMonth(readLog(), Date.now());
}
