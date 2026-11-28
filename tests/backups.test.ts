import assert from "node:assert/strict";
import { BACKUPS, backupRequestId, backupsFor, isModelDown, readBackupRequestId, runWriter, submitWithBackups, WRITER_MODELS } from "../lib/backups";
import { allModelIds, getModel } from "../lib/models";
import { appEndpoints, judgeModel, newTopModels, problems, shouldEmail, problemKey } from "../lib/health";

const m = (id: string) => getModel(id)!;
const opts = { prompt: "a dog on a beach", aspectRatio: "16:9" as const, duration: 5, sound: true };

// Every backup is a real model in the catalogue, of the same kind, and fairly priced.
for (const [first, list] of Object.entries(BACKUPS)) {
  assert.ok(getModel(first), `${first} is in the catalogue`);
  for (const b of list) {
    assert.ok(getModel(b), `${b} is in the catalogue`);
    assert.notEqual(b, first);
    assert.equal(getModel(b)!.kind, getModel(first)!.kind, `${first} -> ${b} same kind`);
  }
}
// Every model people can pick has at least one backup.
for (const id of ["fal-ai/flux/schnell", "fal-ai/nano-banana", "fal-ai/flux-pro/v1.1-ultra", "fal-ai/recraft/v3/text-to-image", "fal-ai/minimax/hailuo-02/standard/text-to-video", "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", "kling/v4/text-to-video", "fal-ai/veo3/fast"])
  assert.ok(backupsFor(m(id), { ...opts, aspectRatio: "16:9" }).length > 0, `${id} has a backup`);

// Veo 3 Fast (fal marks it deprecated) moves to Veo 3.1 Fast first, keeping its sound.
assert.equal(backupsFor(m("fal-ai/veo3/fast"), { ...opts, duration: 8 })[0].model.id, "fal-ai/veo3.1/fast");
// A tall video never goes to Hailuo's words-to-video (wide only).
assert.ok(!backupsFor(m("fal-ai/kling-video/v2.5-turbo/pro/text-to-video"), { ...opts, aspectRatio: "9:16" }).some((b) => b.model.id.includes("hailuo-02/standard/text")));
// Lengths are moved to what the backup can make: Kling 5s -> Hailuo 6s.
assert.equal(backupsFor(m("fal-ai/kling-video/v2.5-turbo/pro/text-to-video"), opts)[0].opts.duration, 6);

// Only "gone or down" moves a job, never our key, our balance or the person's prompt.
assert.ok(isModelDown({ status: 404 }));
assert.ok(isModelDown({ status: 410 }));
assert.ok(isModelDown({ status: 503 }));
assert.ok(isModelDown(new Error("fetch failed")));
assert.ok(isModelDown({ status: 422, body: { detail: "Application 'any-llm' not found" } }));
assert.ok(!isModelDown({ status: 401 }));
assert.ok(!isModelDown({ status: 402 }));
assert.ok(!isModelDown({ status: 403 }));
assert.ok(!isModelDown({ status: 422, body: { detail: "content policy violation" } }));

// The request id says which backup took the job, and the status check reads it back.
const rid = backupRequestId("fal-ai/veo3.1/fast", "0b6c3f9e-1234-4abc-9def-001122334455");
assert.ok(/^[\w-]{8,100}$/.test(rid), "still a valid job id for credits and refunds");
assert.deepEqual(readBackupRequestId(rid, allModelIds()), { modelId: "fal-ai/veo3.1/fast", requestId: "0b6c3f9e-1234-4abc-9def-001122334455" });
assert.equal(readBackupRequestId("0b6c3f9e-1234-4abc-9def-001122334455", allModelIds()), undefined);

async function main() {
  // A retired first model: the job quietly goes to the backup.
  const calls: string[] = [];
  const sent = await submitWithBackups(async (id) => {
    calls.push(id);
    if (id === "fal-ai/veo3/fast") throw Object.assign(new Error("Not found"), { status: 404 });
    return { request_id: "req-12345678" };
  }, m("fal-ai/veo3/fast"), { ...opts, duration: 8 });
  assert.deepEqual(calls, ["fal-ai/veo3/fast", "fal-ai/veo3.1/fast"]);
  assert.equal(sent.model.id, "fal-ai/veo3.1/fast");
  assert.ok(sent.backup && sent.requestId.endsWith("req-12345678"));

  // Working first model: no backup, the plain job id.
  const ok = await submitWithBackups(async () => ({ request_id: "req-abcdefgh" }), m("fal-ai/nano-banana"), opts);
  assert.equal(ok.requestId, "req-abcdefgh");
  assert.equal(ok.backup, false);

  // A refused prompt is not retried on another model.
  let tries = 0;
  await assert.rejects(submitWithBackups(async () => { tries++; throw Object.assign(new Error("bad"), { status: 422, body: { detail: "content policy" } }); }, m("fal-ai/nano-banana"), opts));
  assert.equal(tries, 1);

  // The AI writer moves to the next writer model when the first is gone.
  const asked: string[] = [];
  const r = await runWriter(async (_id, { input }) => {
    asked.push(String(input.model));
    if (input.model === WRITER_MODELS[0]) throw Object.assign(new Error("gone"), { status: 404 });
    return { data: { output: "a plan" } };
  }, "openrouter/router", { model: WRITER_MODELS[0], prompt: "x" });
  assert.equal(r.data?.output, "a plan");
  assert.deepEqual(asked, WRITER_MODELS.slice(0, 2));

  // Health: fal's answers are read correctly.
  assert.equal(judgeModel("a", undefined).state, "missing");
  assert.equal(judgeModel("a", { endpoint_id: "a", metadata: { status: "active" } }).state, "ok");
  assert.equal(judgeModel("a", { endpoint_id: "a", metadata: { status: "deprecated" } }).state, "deprecated");
  assert.equal(judgeModel("a", { endpoint_id: "a", metadata: { status: "active" }, retires_at: new Date(Date.now() + 5 * 86400000).toISOString() }).state, "retiring");
  assert.ok(appEndpoints().includes("openrouter/router") && appEndpoints().includes("fal-ai/veo3.1/fast"));

  const rep = { at: "", models: [{ id: "fal-ai/veo3/fast", state: "deprecated" as const, note: 'fal marks it "deprecated"' }, { id: "x", state: "ok" as const }], services: [{ name: "Site", ok: true }] };
  const list = problems(rep);
  assert.equal(list.length, 1);
  assert.match(list[0], /backup model is ready/);
  // Emails: new problem yes, same problem next day no, after 3 days a reminder, then "all fixed" once.
  assert.equal(shouldEmail(list, null), "problem");
  assert.equal(shouldEmail(list, { key: problemKey(list), at: Date.now() - 86400000 }), null);
  assert.equal(shouldEmail(list, { key: problemKey(list), at: Date.now() - 4 * 86400000 }), "problem");
  assert.equal(shouldEmail([], { key: problemKey(list), at: Date.now() }), "fixed");
  assert.equal(shouldEmail([], null), null);

  // Weekly: new models from big makers that we don't use yet.
  const now = Date.parse("2026-11-28T00:00:00Z");
  const fresh = newTopModels([
    { endpoint_id: "kling/v5/text-to-video", metadata: { status: "active", date: "2026-11-25T00:00:00Z" } },
    { endpoint_id: "kling/v4/text-to-video", metadata: { status: "active", date: "2026-11-26T00:00:00Z" } },
    { endpoint_id: "someone/tiny-model", metadata: { status: "active", date: "2026-11-26T00:00:00Z" } },
    { endpoint_id: "google/old", metadata: { status: "active", date: "2026-09-01T00:00:00Z" } },
  ], ["kling/v4/text-to-video"], 8, now);
  assert.deepEqual(fresh.map((f) => f.endpoint_id), ["kling/v5/text-to-video"]);

  console.log("backups tests passed");
}
main();
