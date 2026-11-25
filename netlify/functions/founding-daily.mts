// Runs once a day on Netlify (scheduled functions work on the free plan, and
// only on the live site, not on previews). It asks the app to send the founding
// price message to members whose free month ends soon, and to move ended months
// to the Free plan. It never charges anyone.

import { cronKey } from "../../lib/accounts/session";

export default async () => {
  const base = process.env.URL;
  if (!base) return new Response("No site address", { status: 500 });
  const r = await fetch(`${base}/api/cron/founding`, { method: "POST", headers: { "x-cron-key": cronKey() } });
  console.log("founding reminders", r.status, (await r.text()).slice(0, 300));
  return new Response("ok");
};

export const config = { schedule: "0 16 * * *" };
