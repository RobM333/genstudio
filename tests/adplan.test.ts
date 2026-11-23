import assert from "node:assert/strict";
import { adCost, adPlanWithRules, endCardSeconds, parseAdPlan, sceneCount } from "../lib/adplan";
import { changedAdJob, newAdJob } from "../components/adRunner";

assert.equal(sceneCount(15), 2);
assert.equal(endCardSeconds(15), 5);
assert.equal(sceneCount(30), 5);
assert.equal(sceneCount(60), 11);
const brief = { product: "Glow bottle", audience: "commuters", seconds: 15, tone: "Friendly" };
const raw = JSON.stringify({
  title: "Glow",
  concept: "c",
  look: "blue bottle",
  music: "pop",
  voice: "Brian",
  scenes: [
    { visual: "A commuter yawns on a train platform", camera: "wide", text: "Tired?", voice: "Long day?" },
    { visual: "She sips cold water from the blue bottle", camera: "close-up", text: "Cold all day", voice: "Stay fresh." },
    { visual: "extra scene that should be dropped", camera: "x", text: "", voice: "" },
  ],
  endCard: { headline: "Glow", tagline: "Shop now", voice: "Glow. Shop now." },
});
const plan = parseAdPlan("Here you go:\n" + raw, brief)!;
assert.equal(plan.scenes.length, 2);
assert.equal(plan.voice, "Brian");
assert.equal(parseAdPlan("nope", brief), null);
assert.equal(adPlanWithRules(brief).scenes.length, 2);
const c = adCost(plan, false);
assert.ok(c > 0.7 && c < 0.85, String(c));

// Changing one scene keeps the other scene's clip.
const job = newAdJob(brief, plan);
job.clips = [{ url: "a", status: "done" }, { url: "b", status: "done" }];
job.joinedUrl = "j";
job.cardClip = "card";
job.cardFor = "Glow|Shop now";
const next = { ...plan, scenes: plan.scenes.map((s, i) => (i === 1 ? { ...s, visual: "At night, she sips" } : s)) };
const changed = changedAdJob(job, next);
assert.equal(changed.scenes, 1);
assert.equal(changed.card, false);
assert.equal(changed.job.clips[0].url, "a");
assert.equal(changed.job.clips[1].url, undefined);
assert.equal(changed.job.joinedUrl, undefined);
console.log("ad plan tests passed");
