import "server-only";
import type { User } from "./store";
import { shownCredits } from "./credits";
import { monthKey } from "../promise";

/** What the browser may know about the signed-in person. */
export function publicUser(u: User) {
  return {
    email: u.email,
    name: u.name ?? "",
    credits: shownCredits(u.credits),
    plan: u.plan,
    planUntil: u.planUntil ?? null,
    founding: Boolean(u.founding),
    admin: Boolean(u.admin),
    voice: u.voice ? { at: u.voice.at } : null,
    promiseUsed: u.promise?.month === monthKey(Date.now()) ? u.promise.used : 0,
    createdAt: u.createdAt,
    passkeys: (u.passkeys ?? []).map((p) => ({ key: p.key, label: p.label, at: p.at, lastUsed: p.lastUsed ?? null })),
  };
}

export type PublicUser = ReturnType<typeof publicUser>;
