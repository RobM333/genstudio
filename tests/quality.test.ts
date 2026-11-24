import assert from "node:assert/strict";
import { allClearlyWrong, badness, extraCost, isPremium, isTextToVideo, jobCost, pickBest, takesFor } from "../lib/quality";
import { animateModelFor, estimateCost, getModel, hdScaleFor } from "../lib/models";
import { readChat } from "../lib/chat";
import { lockInstructions, referenceInstructions } from "../lib/references";

const m = (id: string) => getModel(id)!;

// Premium jobs make two takes; everything else one.
assert.equal(takesFor("kling/v4/text-to-video"), 2);
assert.equal(takesFor("fal-ai/veo3/fast"), 2);
assert.equal(takesFor("fal-ai/minimax/hailuo-02/standard/text-to-video"), 1);
assert.equal(takesFor("fal-ai/nano-banana", "final"), 2);
assert.ok(!isPremium("fal-ai/flux/schnell"));

// Picture first applies only to videos made from words.
assert.ok(isTextToVideo(m("kling/v4/text-to-video")));
assert.ok(!isTextToVideo(m("kling/v4/image-to-video")));
assert.ok(!isTextToVideo(m("fal-ai/topaz/upscale/video")));

// The behind-the-scenes work is always in the price.
const hailuo = m("fal-ai/minimax/hailuo-02/standard/text-to-video");
assert.ok(jobCost(hailuo, 6) > estimateCost(hailuo, 6));
assert.ok(extraCost(hailuo) < 0.06, "one checked picture is about 5 cents");
assert.ok(extraCost(m("kling/v4/text-to-video")) < 0.11, "two checked pictures are about 10 cents");
assert.equal(extraCost(m("fal-ai/flux/schnell")), 0);
assert.equal(extraCost(m("fal-ai/topaz/upscale/video")), 0);

// Kling 4: animate version found, priced at 1080p.
assert.equal(animateModelFor("kling/v4/text-to-video").id, "kling/v4/image-to-video");
assert.equal(animateModelFor("fal-ai/kling-video/v2.5-turbo/pro/text-to-video").id, "fal-ai/kling-video/v2.5-turbo/pro/image-to-video");
assert.equal(animateModelFor("fal-ai/veo3/fast").id, "fal-ai/veo3/fast/image-to-video");
assert.ok(Math.abs(estimateCost(m("kling/v4/text-to-video"), 10) - 2.35) < 0.01);
assert.deepEqual(m("kling/v4/text-to-video").buildInput({ prompt: "x", aspectRatio: "9:16", duration: 10 }), {
  prompt: "x",
  duration: 10,
  resolution: "1080p",
  aspect_ratio: "9:16",
});

// The checker picks the best take: clean beats unknown beats clearly wrong.
const clean = { problems: [], fix: "", prompt: "" };
const small = { problems: ["Slightly warm colours."], fix: "", prompt: "", serious: false };
const wrong = { problems: ["The product is a different bottle."], fix: "Use the right bottle", prompt: "", serious: true, faults: ["product_changed" as const] };
assert.equal(pickBest([wrong, clean]), 1);
assert.equal(pickBest([small, clean]), 1);
assert.equal(pickBest([null, wrong]), 0);
assert.equal(pickBest([clean, clean]), 0);
assert.ok(badness(null) < badness(wrong));
assert.ok(allClearlyWrong([wrong, wrong]));
assert.ok(!allClearlyWrong([wrong, small]));
assert.ok(!allClearlyWrong([]));

// Sharpen to HD: only offered when it isn't sharp already, kept at 1080p.
assert.equal(hdScaleFor("kling/v4/image-to-video"), 0);
assert.equal(hdScaleFor("fal-ai/minimax/hailuo-02/standard/image-to-video"), 1.4);
assert.equal(hdScaleFor("fal-ai/veo3/fast/image-to-video"), 1.5);
assert.equal(hdScaleFor("fal-ai/topaz/upscale/video"), 0);
assert.equal((m("fal-ai/topaz/upscale/video").buildInput({ prompt: "x", aspectRatio: "16:9", scale: 3 }) as { upscale_factor: number }).upscale_factor, 1.5);
assert.deepEqual(readChat("sharpen to HD", "video"), { type: "hd" });
assert.deepEqual(readChat("can you upscale it", "image"), { type: "hd" });
assert.deepEqual(readChat("make it higher quality", "image"), { type: "final" });

// Lock the product: the frame comes first, the user's pictures are numbered after it.
assert.match(referenceInstructions(["product"]), /^Image 1 is/);
assert.match(referenceInstructions(["product"], 1), /^Image 2 is/);
const lock = lockInstructions(["product", "logo"]);
assert.match(lock, /^Image 1 is a frame from a video/);
assert.match(lock, /Image 2 is .*Image 3 is/);
assert.doesNotMatch(lock, /Build a new, realistic scene/);

console.log("quality tests passed");
