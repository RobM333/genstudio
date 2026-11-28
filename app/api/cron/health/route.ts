import { NextResponse } from "next/server";
import { isCronKey } from "@/lib/accounts/session";
import { sendEmail } from "@/lib/accounts/mail";
import { kv } from "@/lib/accounts/kv";
import { askWriter } from "@/lib/fal";
import { appEndpoints, checkAllModels, checkUrl, checkWriter, listCategory, newTopModels, problemKey, problems, shouldEmail, WATCH_CATEGORIES, type HealthReport, type ServiceCheck } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by netlify/functions/model-health-daily.mts (every day) and
// model-watch-weekly.mts (?weekly=1, Mondays), with a key only the server knows.
// Daily: emails the owner only when a model or service has a problem (and once
// when it's fixed). Weekly: always emails a short report, including new top models.

const TO = () => process.env.HEALTH_EMAIL?.trim() || "rob@toastyfly.com";
const LAST_KEY = "health/last-alert";

export async function POST(req: Request) {
  if (!isCronKey(req.headers.get("x-cron-key"))) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const weekly = new URL(req.url).searchParams.get("weekly") === "1";
  const origin = process.env.URL || new URL(req.url).origin;

  const ids = appEndpoints();
  const [models, services] = await Promise.all([checkAllModels(ids), checkServices(origin)]);
  const report: HealthReport = { at: new Date().toISOString(), models, services };
  const list = problems(report);
  console.log("health check", list.length ? list : "all good");

  if (weekly) {
    const all = (await Promise.all(WATCH_CATEGORIES.map((c) => listCategory(c)))).flat();
    const fresh = newTopModels(all, ids).slice(0, 25);
    const r = await sendEmail(TO(), weeklySubject(list.length, fresh.length), weeklyText(list, fresh, models.length), weeklyHtml(list, fresh, models.length));
    return NextResponse.json({ ok: true, weekly: true, problems: list, newModels: fresh.map((m) => m.endpoint_id), emailed: r.ok });
  }

  const store = await kv();
  const last = await store.get<{ key: string; at: number }>(LAST_KEY).catch(() => null);
  const send = shouldEmail(list, last);
  let emailed = false;
  if (send === "problem") {
    emailed = (await sendEmail(TO(), `ToastyFly check: ${list.length} problem${list.length === 1 ? "" : "s"} found`, problemText(list), problemHtml(list))).ok;
    if (emailed) await store.set(LAST_KEY, { key: problemKey(list), at: Date.now() });
  } else if (send === "fixed") {
    emailed = (await sendEmail(TO(), "ToastyFly check: all fixed", "Good news: every AI model and service ToastyFly uses is working again.", wrap("<p>Good news: every AI model and service ToastyFly uses is working again.</p>"))).ok;
    if (emailed) await store.delete(LAST_KEY);
  }
  return NextResponse.json({ ok: true, checked: models.length, problems: list, emailed });
}

async function checkServices(origin: string): Promise<ServiceCheck[]> {
  const checks: Promise<ServiceCheck>[] = [checkWriter(askWriter), checkUrl("The ToastyFly website", `${origin}/`)];
  const pixabay = process.env.PIXABAY_API_KEY?.trim();
  if (pixabay) checks.push(checkUrl("Pixabay stock videos", `https://pixabay.com/api/videos/?key=${encodeURIComponent(pixabay)}&q=coffee&per_page=3`));
  const results = await Promise.all(checks);
  // Pixabay's address carries the key, so it's never shown; only its name and result are.
  return results;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const wrap = (inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#14141a">${inner}<p style="color:#777;font-size:12px;margin-top:32px">Sent by ToastyFly's automatic model check.</p></div>`;

function problemText(list: string[]) {
  return `ToastyFly's daily check found ${list.length === 1 ? "a problem" : "some problems"}:\n\n${list.map((p) => `- ${p}`).join("\n")}\n\nWhere a backup model is ready, people still get results. Ask Claude in the ToastyFly project to fix the rest.`;
}
function problemHtml(list: string[]) {
  return wrap(`<p>ToastyFly's daily check found ${list.length === 1 ? "a problem" : "some problems"}:</p><ul>${list.map((p) => `<li>${esc(p)}</li>`).join("")}</ul><p>Where a backup model is ready, people still get results. Ask Claude in the ToastyFly project to fix the rest.</p>`);
}

type Fresh = { endpoint_id: string; metadata?: { display_name?: string; category?: string; date?: string } };
const freshLine = (m: Fresh) => `${m.metadata?.display_name ?? m.endpoint_id} (${m.metadata?.category ?? "model"}, ${String(m.metadata?.date ?? "").slice(0, 10)}): https://fal.ai/models/${m.endpoint_id}`;

function weeklySubject(problemCount: number, freshCount: number) {
  return `ToastyFly weekly model check: ${problemCount ? `${problemCount} to fix, ` : "all working, "}${freshCount} new model${freshCount === 1 ? "" : "s"} to look at`;
}
function weeklyText(list: string[], fresh: Fresh[], checked: number) {
  const a = list.length ? `Needs fixing:\n${list.map((p) => `- ${p}`).join("\n")}` : `All ${checked} AI models and services ToastyFly uses are working.`;
  const b = fresh.length ? `New models from the big makers this week (not in ToastyFly yet):\n${fresh.map((m) => `- ${freshLine(m)}`).join("\n")}` : "No new models from the big makers this week.";
  return `${a}\n\n${b}\n\nTo add one, ask Claude in the ToastyFly project. It will tell you the price and test cost first.`;
}
function weeklyHtml(list: string[], fresh: Fresh[], checked: number) {
  const a = list.length ? `<p><b>Needs fixing:</b></p><ul>${list.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p>All ${checked} AI models and services ToastyFly uses are working.</p>`;
  const b = fresh.length ? `<p><b>New models from the big makers this week</b> (not in ToastyFly yet):</p><ul>${fresh.map((m) => `<li>${esc(freshLine(m))}</li>`).join("")}</ul>` : "<p>No new models from the big makers this week.</p>";
  return wrap(`${a}${b}<p>To add one, ask Claude in the ToastyFly project. It will tell you the price and test cost first.</p>`);
}
