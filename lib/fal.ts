import "server-only";
import { fal } from "@fal-ai/client";

// The key is read from the FAL_KEY secret environment variable on the server.
// It is never sent to the browser.
fal.config({ credentials: () => process.env.FAL_KEY ?? "" });

export { fal };

/** Asks the AI writer (planning, prompt boosting, ideas); moves to a backup writer model if the first is gone or down. */
export async function askWriter(input: Record<string, unknown>) {
  const { runWriter } = await import("./backups");
  return runWriter((id, args) => fal.run(id, args), "openrouter/router", input);
}

/** Starts a picture check on the vision writer; tries the backup writer models if the first is gone or down. */
export async function submitCheck(endpoint: string, input: Record<string, unknown>): Promise<{ request_id: string }> {
  const { isModelDown, WRITER_MODELS } = await import("./backups");
  const first = String(input.model ?? WRITER_MODELS[0]);
  let last: unknown;
  for (const model of [first, ...WRITER_MODELS.filter((m) => m !== first)]) {
    try {
      return await fal.queue.submit(endpoint, { input: { ...input, model } });
    } catch (err) {
      last = err;
      if (!isModelDown(err)) throw err;
    }
  }
  throw last;
}
