// Runs every Monday on Netlify (live site only). Emails the owner a short
// report: any model that fal has retired or marked old, and new top models
// from the big makers worth adding. Free apart from one tiny AI writer question.

import { cronKey } from "../../lib/accounts/session";

export default async () => {
  const base = process.env.URL;
  if (!base) return new Response("No site address", { status: 500 });
  const r = await fetch(`${base}/api/cron/health?weekly=1`, { method: "POST", headers: { "x-cron-key": cronKey() } });
  console.log("model watch", r.status, (await r.text()).slice(0, 600));
  return new Response("ok");
};

// Mondays 15:00 UTC = 7 AM Pacific.
export const config = { schedule: "0 15 * * 1" };
