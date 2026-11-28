// Health checks for the AI models and services ToastyFly depends on.
//
// Daily (free): asks fal's public model list whether every model id the app
// uses still exists and isn't marked deprecated or due to retire, and checks
// that fal, the AI writer, stock video and the site itself answer. The only
// paid part is one tiny AI writer question (a few words, well under a tenth
// of a cent), which also proves the fal key works and the balance isn't empty.
//
// Weekly (free): lists new models on fal from the big makers that we don't use
// yet, so the newest top models can be added soon after they launch.

import { allModelIds } from "./models";
import { BACKUPS, WRITER_MODELS } from "./backups";
import { IMAGE_ANALYZER, SPEECH_CHECKER, VIDEO_ANALYZER } from "./analyze";
import { TALK_SPEECH_MODEL_ID, TALK_VIDEO_MODEL_ID, TRANSCRIBE_MODEL_ID, VOICE_CLONE_MODEL_ID } from "./talk";

export const WRITER_ENDPOINT = "openrouter/router";

/** Every fal endpoint the app can call, including backups. */
export function appEndpoints(): string[] {
  const ids = [
    ...allModelIds(),
    ...Object.values(BACKUPS).flat(),
    WRITER_ENDPOINT,
    IMAGE_ANALYZER,
    VIDEO_ANALYZER,
    SPEECH_CHECKER,
    TALK_SPEECH_MODEL_ID,
    TALK_VIDEO_MODEL_ID,
    TRANSCRIBE_MODEL_ID,
    VOICE_CLONE_MODEL_ID,
  ];
  return [...new Set(ids)].sort();
}

export type FalModel = {
  endpoint_id: string;
  metadata?: { display_name?: string; category?: string; status?: string; date?: string };
  retires_at?: string | null;
  replacement?: string | null;
};

export type ModelCheck = { id: string; state: "ok" | "deprecated" | "retiring" | "missing" | "unknown"; note?: string; replacement?: string };

/** Reads fal's answer about one model. */
export function judgeModel(id: string, found: FalModel | undefined, now = Date.now()): ModelCheck {
  if (!found) return { id, state: "missing", note: "fal no longer lists this model" };
  const replacement = found.replacement ?? undefined;
  if (found.retires_at) {
    const when = Date.parse(found.retires_at);
    const days = Number.isFinite(when) ? Math.round((when - now) / 86400000) : undefined;
    return { id, state: "retiring", note: days !== undefined ? (days <= 0 ? "fal says it has retired" : `fal says it retires in ${days} days`) : "fal says it will retire", replacement };
  }
  const status = found.metadata?.status;
  if (status && status !== "active") return { id, state: "deprecated", note: `fal marks it "${status}"`, replacement };
  return { id, state: "ok" };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function falHeaders(): Record<string, string> {
  const key = process.env.FAL_KEY?.trim();
  return key ? { Authorization: `Key ${key}` } : {};
}

/** Asks fal's public model list about one model (free). Retries once if fal asks us to slow down. */
export async function checkFalModel(id: string, f: Fetch = fetch): Promise<ModelCheck> {
  const url = `https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(id)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await f(url, { headers: falHeaders(), signal: AbortSignal.timeout(8000) });
      if (r.status === 429 || r.status >= 500) {
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        continue;
      }
      if (r.status === 404 || r.status === 400) return judgeModel(id, undefined);
      if (!r.ok) return { id, state: "unknown", note: `fal's model list answered ${r.status}` };
      const data = (await r.json()) as { models?: FalModel[] };
      return judgeModel(id, data.models?.find((m) => m.endpoint_id === id));
    } catch {
      // try again
    }
  }
  return { id, state: "unknown", note: "fal's model list didn't answer" };
}

/** Checks many models, a few at a time. */
export async function checkAllModels(ids: string[], f: Fetch = fetch): Promise<ModelCheck[]> {
  const out: ModelCheck[] = [];
  for (let i = 0; i < ids.length; i += 6) out.push(...(await Promise.all(ids.slice(i, i + 6).map((id) => checkFalModel(id, f)))));
  return out;
}

export type ServiceCheck = { name: string; ok: boolean; note?: string };

/** One tiny question to the AI writer: proves fal, our key, our balance and the writer all work. */
export async function checkWriter(ask: (input: Record<string, unknown>) => Promise<{ data?: { output?: string } }>): Promise<ServiceCheck> {
  try {
    const r = await ask({ model: WRITER_MODELS[0], system_prompt: "Reply with the single word OK.", prompt: "Health check. Reply OK." });
    return r?.data?.output ? { name: "fal.ai and the AI writer", ok: true } : { name: "fal.ai and the AI writer", ok: false, note: "answered with nothing" };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const note =
      status === 401 || status === 403
        ? "fal rejected our key (FAL_KEY)"
        : status === 402
          ? "the fal balance looks empty: top up at https://fal.ai/dashboard/billing"
          : `didn't answer (${status ?? "no reply"})`;
    return { name: "fal.ai and the AI writer", ok: false, note };
  }
}

export async function checkUrl(name: string, url: string, f: Fetch = fetch, init?: RequestInit): Promise<ServiceCheck> {
  try {
    const r = await f(url, { ...init, signal: AbortSignal.timeout(10000) });
    return r.ok ? { name, ok: true } : { name, ok: false, note: `answered ${r.status}` };
  } catch {
    return { name, ok: false, note: "didn't answer" };
  }
}

export type HealthReport = { at: string; models: ModelCheck[]; services: ServiceCheck[] };

/** The problems worth telling Rob about. "unknown" only counts when fal's list itself is down for most models. */
export function problems(r: HealthReport): string[] {
  const out: string[] = [];
  const unknown = r.models.filter((m) => m.state === "unknown");
  for (const m of r.models) {
    if (m.state === "ok" || m.state === "unknown") continue;
    out.push(`${m.id}: ${m.note}${m.replacement ? ` (fal suggests ${m.replacement})` : ""}${BACKUPS[m.id]?.length ? ". A backup model is ready, so people still get results." : "."}`);
  }
  if (unknown.length > r.models.length / 2) out.push("fal's model list didn't answer, so the models couldn't be checked today.");
  for (const s of r.services) if (!s.ok) out.push(`${s.name}: ${s.note ?? "not working"}`);
  return out;
}

/** A short fingerprint of today's problems, so the same problem isn't emailed every day. */
export function problemKey(list: string[]): string {
  return list.map((p) => p.replace(/\d+ days/, "")).sort().join("|");
}

/** Email when something new breaks, a reminder every 3 days while it lasts, and once when it's all fixed. */
export function shouldEmail(list: string[], last: { key: string; at: number } | null, now = Date.now()): "problem" | "fixed" | null {
  const key = problemKey(list);
  if (!list.length) return last?.key ? "fixed" : null;
  if (!last || last.key !== key) return "problem";
  return now - last.at >= 3 * 86400000 ? "problem" : null;
}

// ---------- Weekly: new top models ----------

/** Makers whose new models are worth a look. */
export const TOP_MAKERS = [
  "kling", "fal-ai/kling", "google", "fal-ai/veo", "fal-ai/nano-banana", "minimax", "fal-ai/minimax", "bytedance", "fal-ai/bytedance",
  "openai", "fal-ai/sora", "blackforestlabs", "fal-ai/flux", "alibaba", "fal-ai/wan", "lightricks", "fal-ai/ltx", "luma", "fal-ai/luma",
  "pixverse", "fal-ai/pixverse", "runway", "xai", "ideogram", "fal-ai/ideogram", "recraft", "fal-ai/recraft", "elevenlabs", "fal-ai/elevenlabs",
  "heygen", "meta", "tencent", "fal-ai/hunyuan",
];

export const WATCH_CATEGORIES = ["text-to-video", "image-to-video", "text-to-image", "image-to-image", "text-to-speech", "text-to-audio"];

export function isTopMaker(id: string): boolean {
  return TOP_MAKERS.some((p) => id.startsWith(p));
}

/** New, active models from the big makers that the app doesn't use yet, newest first. */
export function newTopModels(all: FalModel[], ours: string[], sinceDays = 8, now = Date.now()): FalModel[] {
  const since = now - sinceDays * 86400000;
  const mine = new Set(ours);
  const seen = new Set<string>();
  return all
    .filter((m) => {
      if (seen.has(m.endpoint_id)) return false;
      seen.add(m.endpoint_id);
      const d = Date.parse(m.metadata?.date ?? "");
      return Number.isFinite(d) && d >= since && (m.metadata?.status ?? "active") === "active" && !mine.has(m.endpoint_id) && isTopMaker(m.endpoint_id);
    })
    .sort((a, b) => Date.parse(b.metadata?.date ?? "") - Date.parse(a.metadata?.date ?? ""));
}

/** Reads one category of fal's model list, a few pages deep (free). */
export async function listCategory(category: string, f: Fetch = fetch, pages = 8): Promise<FalModel[]> {
  const out: FalModel[] = [];
  let cursor = "";
  for (let i = 0; i < pages; i++) {
    const url = `https://api.fal.ai/v1/models?category=${encodeURIComponent(category)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    try {
      const r = await f(url, { headers: falHeaders(), signal: AbortSignal.timeout(10000) });
      if (!r.ok) break;
      const data = (await r.json()) as { models?: FalModel[]; next_cursor?: string | null; has_more?: boolean };
      out.push(...(data.models ?? []));
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
    } catch {
      break;
    }
  }
  return out;
}
