// Runs once a day on Netlify (only on the live site, not on previews). It asks
// the app to check that every AI model and service ToastyFly uses still works,
// and to email the owner if one doesn't. Free apart from one tiny AI writer
// question (well under a tenth of a cent).

import { cronKey } from "../../lib/accounts/session";

export default async () => {
  const base = process.env.URL;
  if (!base) return new Response("No site address", { status: 500 });
  const r = await fetch(`${base}/api/cron/health`, { method: "POST", headers: { "x-cron-key": cronKey() } });
  console.log("model health", r.status, (await r.text()).slice(0, 600));
  return new Response("ok");
};

// 14:00 UTC = 6 AM Pacific.
export const config = { schedule: "0 14 * * *" };
