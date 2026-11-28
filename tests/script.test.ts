import assert from "node:assert/strict";
import {
  alignRecording,
  applyLook,
  beatSeconds,
  captionsFile,
  lookRange,
  parseScriptBatch,
  partKey,
  ruleSearch,
  scriptCost,
  scriptPlanWithRules,
  shotCost,
  splitScript,
  tidyScript,
  wordTimings,
  newScriptJob,
} from "../lib/script";

// The words are kept exactly: the lines joined back are the script.
const script = `Most people think saving money is about willpower. It isn't. It's about systems, small automatic habits that run in the background while you live your life, and that quietly add up to something big over the years.

Here's the first one. Pay yourself first! The moment your pay lands, move ten percent into a separate account you never look at.

Second: make it boring.`;
const lines = splitScript(script);
assert.equal(lines.join(" "), tidyScript(script).replace(/\n\n/g, " "));
for (const l of lines) assert.ok(l.split(" ").length <= 20, `line too long: ${l}`);
assert.ok(lines.length >= 4 && lines.length <= 9, `got ${lines.length} lines`);
// Short sentences are joined, not left as one-word shots.
assert.ok(!lines.includes("It isn't."));
// Paragraphs are never joined into one line.
assert.ok(lines.some((l) => l.startsWith("Here's the first one.")));
assert.ok(lines.some((l) => l.startsWith("Second:")));

// A 10-minute script (about 1,500 words) is fine and stays exact.
const long = Array.from({ length: 150 }, (_, i) => `This is sentence number ${i + 1} of a long script, and it has a few more words in it.`).join(" ");
const longLines = splitScript(long);
assert.equal(longLines.join(" "), long);
assert.ok(longLines.length > 100);

// Prices: All AI costs most, Budget least; ranges have low below high.
const ai = lookRange(longLines, "ai", { voice: "stock", captions: true, music: true }, true);
const mix = lookRange(longLines, "mix", { voice: "stock", captions: true, music: true }, true);
const budget = lookRange(longLines, "budget", { voice: "stock", captions: true, music: true }, true);
assert.ok(ai[0] < ai[1] && mix[0] < mix[1] && budget[0] < budget[1]);
assert.ok(ai[0] > mix[1] && mix[0] > budget[0]);
assert.equal(shotCost("stock", 4), 0);
assert.equal(shotCost("mine", 4), 0);
assert.ok(shotCost("ai", 6) > shotCost("ai", 4));

// Looks: Mix gives the opening and key lines AI, the rest stock; lines the person set stay.
const plan = scriptPlanWithRules(lines);
plan.beats[2].key = true;
plan.beats[3] = { ...plan.beats[3], source: "mine", clip: 0, pinned: true };
const mixed = applyLook(plan, "mix", true);
assert.equal(mixed.beats[0].source, "ai");
assert.equal(mixed.beats[1].source, "stock");
assert.equal(mixed.beats[2].source, "ai");
assert.equal(mixed.beats[3].source, "mine");
assert.equal(applyLook(plan, "budget", false).beats[1].source, "still");
assert.ok(scriptCost(applyLook(plan, "ai", true), { voice: "stock", captions: false, music: false }) > scriptCost(applyLook(plan, "budget", true), { voice: "stock", captions: false, music: false }));

// The planner's reply is read; a missing shot is filled in by rule.
const batch = parseScriptBatch(`{"title":"Save","look":"warm","music":"piano","shots":[{"visual":"A glass jar slowly filling with coins on a kitchen table","search":"coins jar","key":true}]}`, lines.slice(0, 2));
assert.equal(batch.title, "Save");
assert.equal(batch.beats[0].key, true);
assert.equal(batch.beats[1].text, lines[1]);
assert.ok(batch.beats[1].visual.length > 8 && batch.beats[1].search.length > 0);
assert.equal(parseScriptBatch("not json", ["Hello there friend."]).beats.length, 1);
assert.equal(ruleSearch("The ocean waves crash on rocks"), "ocean waves crash");

// The person's own recording is lined up with the lines by the words heard.
const rec = ["Hello and welcome to the show.", "Today we talk about money.", "Let's begin."];
const heard = "hello and welcome to the show today we talk about money lets begin".split(" ").map((text, i) => ({ text, start: i * 0.5 }));
const lens = alignRecording(rec, heard, 7);
assert.equal(lens.length, 3);
assert.ok(Math.abs(lens[0] - 3) < 0.01, `first line ${lens[0]}`);
assert.ok(Math.abs(lens[1] - 2.5) < 0.01, `second line ${lens[1]}`);
// Nothing heard: the time is shared by word count.
const shared = alignRecording(rec, [], 12);
assert.ok(Math.abs(shared.reduce((a, b) => a + b, 0) - 12) < 0.01);
assert.deepEqual(wordTimings([{ text: " hi", timestamp: [0.2, 0.4] }, { word: "yo", start: 1 }]), [
  { text: "hi", start: 0.2 },
  { text: "yo", start: 1 },
]);

// The captions file has the exact words and times.
const srt = captionsFile(["Hello there.", "Bye now."], [2, 1.5]);
assert.ok(srt.startsWith("1\n00:00:00,000 --> 00:00:01,950\nHello there.\n"));
assert.ok(srt.includes("2\n00:00:02,000 --> 00:00:03,450\nBye now."));

// A changed line, source or clip means a new shot; the same one is kept.
const job = newScriptJob({ plan: mixed, aspectRatio: "16:9", voice: { kind: "stock", voice: "Rachel" }, language: "English", captions: true, music: true, clips: [{ url: "https://v3.fal.media/a.mp4", name: "a", seconds: 4 }] });
const k1 = partKey(job, 0, 4.2);
assert.equal(partKey(job, 0, 4.4), k1); // an AI shot is 5 seconds either way
assert.notEqual(partKey({ ...job, plan: { ...job.plan, beats: job.plan.beats.map((b, i) => (i === 0 ? { ...b, visual: "something else" } : b)) } }, 0, 4.2), k1);
assert.ok(partKey(job, 3, 4).startsWith("mine|https://v3.fal.media/a.mp4"));
assert.ok(beatSeconds("one two three four five") > 2);

console.log("script tests passed");
