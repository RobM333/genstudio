// Decides how the app runs, based on secret environment variables.
// The values themselves never leave the server.

export type AppMode = "demo" | "live" | "locked";

export function getMode(): AppMode {
  const hasKey = Boolean(process.env.FAL_KEY?.trim());
  const hasPassword = Boolean(process.env.APP_PASSWORD?.trim());
  if (!hasKey) return "demo";
  // A real key without a password would let anyone on the internet
  // spend fal.ai credit, so real generation stays off until both are set.
  if (!hasPassword) return "locked";
  return "live";
}
