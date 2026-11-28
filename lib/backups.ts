// Backup models. AI services retire or break models with little warning (fal
// retired the planner model in November 2026). When a model can't take a job
// because it is gone or its service is down, the job quietly goes to a similar
// model instead, so the person sees a result, not an error.
//
// Rules for a backup:
// - it makes the same kind of thing from the same kind of input (words to video,
//   picture to video, words to picture, ...)
// - it doesn't cost us much more than the model the person picked (they were
//   charged for that one); see backupCostOk
// - it is only used when the first model is gone or down, never because of the
//   person's prompt, their settings, our key or our balance

import { estimateCost, getModel, type AspectRatio, type ModelInfo } from "./models";

/** Similar models to try, best first, when the first one can't take the job. */
export const BACKUPS: Record<string, string[]> = {
  // Words to picture
  "fal-ai/flux/schnell": ["fal-ai/nano-banana"],
  "fal-ai/nano-banana": ["fal-ai/recraft/v3/text-to-image", "fal-ai/flux/schnell"],
  "fal-ai/flux-pro/v1.1-ultra": ["fal-ai/nano-banana"],
  "fal-ai/recraft/v3/text-to-image": ["fal-ai/nano-banana"],
  // Pictures with the person's own references
  "fal-ai/nano-banana/edit": ["fal-ai/nano-banana-pro/edit"],
  "fal-ai/nano-banana-pro/edit": ["fal-ai/nano-banana/edit"],
  // Words to video
  "fal-ai/kling-video/v2.5-turbo/pro/text-to-video": ["fal-ai/minimax/hailuo-02/standard/text-to-video"],
  "fal-ai/minimax/hailuo-02/standard/text-to-video": ["fal-ai/kling-video/v2.5-turbo/pro/text-to-video"],
  "fal-ai/veo3/fast": ["fal-ai/veo3.1/fast", "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", "fal-ai/minimax/hailuo-02/standard/text-to-video"],
  "kling/v4/text-to-video": ["fal-ai/kling-video/v2.5-turbo/pro/text-to-video", "fal-ai/minimax/hailuo-02/standard/text-to-video"],
  // Picture to video
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video": ["fal-ai/minimax/hailuo-02/standard/image-to-video"],
  "fal-ai/minimax/hailuo-02/standard/image-to-video": ["fal-ai/kling-video/v2.5-turbo/pro/image-to-video"],
  "fal-ai/veo3/fast/image-to-video": ["fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "fal-ai/minimax/hailuo-02/standard/image-to-video"],
  "kling/v4/image-to-video": ["fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "fal-ai/minimax/hailuo-02/standard/image-to-video"],
  // Talking scenes said on screen (voice and mouth made together)
  "fal-ai/kling-video/v3/pro/image-to-video": ["bytedance/seedance-2.5/image-to-video"],
};

/** The AI writer models behind planning, prompt boosting and checks, best first. */
export const WRITER_MODELS = ["google/gemini-2.5-flash", "openai/gpt-4.1-mini", "anthropic/claude-haiku-4.5"];

/** A backup may cost up to double the first model, or up to 12 cents more for one job. */
export function backupCostOk(first: ModelInfo, backup: ModelInfo, duration?: number): boolean {
  const a = estimateCost(first, duration, false);
  const b = estimateCost(backup, nearestDuration(backup, duration), false);
  return b <= Math.max(a * 2, a + 0.12);
}

function nearestDuration(m: ModelInfo, duration?: number): number | undefined {
  if (!m.durations?.length || duration === undefined) return m.durations?.[0];
  return m.durations.reduce((best, d) => (Math.abs(d - duration) < Math.abs(best - duration) ? d : best), m.durations[0]);
}

type Opts = Parameters<ModelInfo["buildInput"]>[0];

/** The backups that can really do this job: same kind of job, the shape asked for, and a fair price. */
export function backupsFor(first: ModelInfo, opts: Opts): { model: ModelInfo; opts: Opts }[] {
  const out: { model: ModelInfo; opts: Opts }[] = [];
  for (const id of BACKUPS[first.id] ?? []) {
    const m = getModel(id);
    if (!m || m.kind !== first.kind || Boolean(m.takesImage) !== Boolean(first.takesImage) || Boolean(m.needsSource) !== Boolean(first.needsSource)) continue;
    if (!m.aspectRatios.includes(opts.aspectRatio as AspectRatio)) continue;
    if (!backupCostOk(first, m, opts.duration)) continue;
    out.push({ model: m, opts: { ...opts, duration: first.kind === "video" ? nearestDuration(m, opts.duration) : opts.duration } });
  }
  return out;
}

/**
 * Should the job move to a backup? Only when the model itself is gone or its
 * service is down. Not when our key or balance is the problem (a backup on the
 * same account would fail too) and not when the prompt or settings were refused.
 */
export function isModelDown(err: unknown): boolean {
  const e = err as { status?: number; body?: { detail?: unknown }; message?: string };
  const status = Number(e?.status);
  const detail = `${typeof e?.body?.detail === "string" ? e.body.detail : JSON.stringify(e?.body?.detail ?? "")} ${e?.message ?? ""}`;
  if (status === 401 || status === 402 || status === 403) return false;
  if (status === 404 || status === 410) return true;
  if (status === 429 || status >= 500) return true;
  if (status === 422 || status === 400) return /not found|no longer|deprecated|retired|unavailable|does not exist|unknown (app|model|endpoint)/i.test(detail);
  // No status at all: the service didn't answer (network trouble, timeout).
  return !status;
}

// A job sent to a backup gets a request id that says which model it went to, so
// checking on it later reaches the right model, whatever model the page asks about.
// The code is a short fingerprint of the model id, so it stays the same between deploys.

export function modelCode(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function backupRequestId(modelId: string, requestId: string): string {
  return `bk${modelCode(modelId)}_${requestId}`;
}

/** Reads a request id made by backupRequestId. Undefined for an ordinary one. */
export function readBackupRequestId(requestId: string, known: string[]): { modelId: string; requestId: string } | undefined {
  const m = /^bk([0-9a-f]{8})_([\w-]{8,100})$/.exec(requestId);
  if (!m) return undefined;
  const modelId = known.find((id) => modelCode(id) === m[1]);
  return modelId ? { modelId, requestId: m[2] } : undefined;
}

type Submit = (endpoint: string, args: { input: Record<string, unknown> }) => Promise<{ request_id: string }>;

/**
 * Sends a job to the first model, and if that model is gone or down, to each
 * backup in turn. Returns the request id to give the page and the model used.
 */
export async function submitWithBackups(
  submit: Submit,
  first: ModelInfo,
  opts: Opts,
  input?: Record<string, unknown>,
): Promise<{ requestId: string; model: ModelInfo; backup: boolean }> {
  try {
    const { request_id } = await submit(first.id, { input: input ?? first.buildInput(opts) });
    return { requestId: request_id, model: first, backup: false };
  } catch (err) {
    if (!isModelDown(err)) throw err;
    let last = err;
    for (const b of backupsFor(first, opts)) {
      try {
        const { request_id } = await submit(b.model.id, { input: b.model.buildInput(b.opts) });
        console.warn(`model backup used: ${first.id} -> ${b.model.id}`, describe(err));
        return { requestId: backupRequestId(b.model.id, request_id), model: b.model, backup: true };
      } catch (e) {
        last = e;
        if (!isModelDown(e)) throw e;
      }
    }
    throw last;
  }
}

type Run = (endpoint: string, args: { input: Record<string, unknown> }) => Promise<unknown>;

/**
 * Asks the AI writer (planning, prompt boosting, ideas). If its model is gone or
 * down, or it answers with an error, the same question goes to the next writer model.
 */
export async function runWriter(run: Run, endpoint: string, input: Record<string, unknown>): Promise<{ data?: { output?: string; error?: string } }> {
  const first = String(input.model ?? WRITER_MODELS[0]);
  const models = [first, ...WRITER_MODELS.filter((m) => m !== first)];
  let last: unknown;
  for (const model of models) {
    try {
      const r = (await run(endpoint, { input: { ...input, model } })) as { data?: { output?: string; error?: string } };
      if (r?.data?.output && !r.data.error) {
        if (model !== first) console.warn(`writer backup used: ${first} -> ${model}`);
        return r;
      }
      last = new Error(r?.data?.error || "empty answer");
    } catch (err) {
      last = err;
      if (!isModelDown(err)) throw err;
    }
  }
  throw last;
}

/** The backup writer models to try for a queued check, after the first one. */
export function writerBackups(first = WRITER_MODELS[0]): string[] {
  return WRITER_MODELS.filter((m) => m !== first);
}

function describe(err: unknown): string {
  const e = err as { status?: number; message?: string };
  return `${e?.status ?? "no status"} ${String(e?.message ?? "").slice(0, 200)}`;
}
