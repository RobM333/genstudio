// Sends "learn from every fix" reports from the browser. Fire and forget: it
// never slows anything down, never shows an error, and costs nothing.
//
// The browser makes one random number the first time (kept in this browser),
// used only so the server can count different people. No name, email, picture
// or voice is sent. When accounts arrive, the account replaces this number.

import type { FeedbackKind, FeedbackSource } from "@/lib/learn";

const KEY = "toastyfly.learn.visitor";

function visitor(): string {
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return "no-storage-visitor";
  }
}

export type Report = {
  source: FeedbackSource;
  kind: FeedbackKind;
  model: string;
  result: string; // the result's random id
  template?: string;
  note?: string; // what the person said was wrong
  problems?: string[]; // what "Find what's wrong" listed
  faults?: string[];
  lessons?: string[]; // the learned rules this result was made with
};

export function report(r: Report): void {
  try {
    const body = JSON.stringify({ ...r, note: r.note?.slice(0, 1000), visitor: visitor() });
    void fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // never in the way
  }
}
