import "server-only";
import { fal } from "@fal-ai/client";

// The key is read from the FAL_KEY secret environment variable on the server.
// It is never sent to the browser.
fal.config({ credentials: () => process.env.FAL_KEY ?? "" });

export { fal };
