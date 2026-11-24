// Decides how the app runs, based on secret environment variables.
// The values themselves never leave the server.

import { accountsOn } from "./accounts/config";

export type AppMode = "demo" | "live" | "locked";

export function getMode(): AppMode {
  const hasKey = Boolean(process.env.FAL_KEY?.trim());
  const hasPassword = Boolean(process.env.APP_PASSWORD?.trim());
  if (!hasKey) return "demo";
  // A real key with nothing guarding it would let anyone on the internet
  // spend fal.ai credit, so real generation stays off until the app is
  // protected: by the shared password, or by accounts (each person signs in
  // and spends their own credits).
  if (!hasPassword && !accountsOn()) return "locked";
  return "live";
}
