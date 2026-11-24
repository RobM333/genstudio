import "server-only";
import { NextResponse } from "next/server";
import { accountsOn } from "./config";
import { cookieFrom, readSession } from "./session";
import { chargeStep, changeCredits, getUser, recordCharge, refundCharge, type User } from "./store";
import { creditsForUsd } from "./credits";

/** The signed-in person, or null (also null when accounts are off). */
export async function currentUser(req: Request): Promise<User | null> {
  if (!accountsOn()) return null;
  const s = readSession(cookieFrom(req.headers.get("cookie")));
  if (!s) return null;
  const user = await getUser(s.userId);
  return user && user.sv === s.version ? user : null;
}

export function signInNeeded() {
  return NextResponse.json({ error: "Please sign in again.", signIn: true }, { status: 401 });
}

export type PaidStep =
  | { error: NextResponse }
  | { error?: undefined; user: User | null; credits: number; done: (requestId: string) => Promise<void>; undo: () => Promise<void> };

/**
 * Takes the credits for one AI step from the signed-in person before it starts.
 * Call done() with the job id once it has started, or undo() if it couldn't start.
 * When accounts are off this does nothing (the shared password protects the app).
 */
export async function payForStep(req: Request, usd: number, what: string): Promise<PaidStep> {
  const noop = { user: null, credits: 0, done: async () => {}, undo: async () => {} };
  if (!accountsOn()) return noop;
  const user = await currentUser(req);
  if (!user) return { error: signInNeeded() };
  const credits = creditsForUsd(usd);
  if (credits <= 0) return { ...noop, user };
  const r = await chargeStep(user.id, credits, what);
  if (!r.ok) {
    const left = Math.floor(r.balance ?? 0);
    return {
      error: NextResponse.json(
        {
          error: `You're out of credits for this. It needs about ${Math.ceil(credits)} and you have ${left} left. Nothing was used.`,
          outOfCredits: true,
        },
        { status: 402 },
      ),
    };
  }
  return {
    user: r.user,
    credits,
    done: async (requestId) => recordCharge(requestId, { userId: user.id, credits, what, at: Date.now() }),
    undo: async () => {
      await changeCredits(user.id, credits, "refund", `Given back: ${what} couldn't start`);
    },
  };
}

/** A job failed on the AI service: its credits go back. */
export async function stepFailed(req: Request, requestId: string, why = "the job didn't finish") {
  if (!accountsOn()) return;
  const user = await currentUser(req);
  await refundCharge(requestId, user?.id ?? null, why).catch((e) => console.error("refund failed", e));
}
