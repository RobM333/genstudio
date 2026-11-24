import assert from "node:assert/strict";
import {
  activeLessons,
  catalogue,
  classify,
  EMPTY_SETTINGS,
  lessonsBlock,
  mergeAvoid,
  MIN_PEOPLE,
  MIN_REPORTS,
  MIN_RESULTS_TO_COMPARE,
  ruleId,
  scrub,
  summarize,
  toEvent,
  type FeedbackEvent,
  type LearnSettings,
} from "../lib/learn";
import { enhancePrompt, enhanceWithRules } from "../lib/enhance";
import { getModel, MODELS } from "../lib/models";

// ---- Reading what kind of problem a note describes (free, no AI) ----
assert.deepEqual(classify("The headline is misspelled, it says SUMMR SAEL"), ["garbled_text"]);
assert.deepEqual(classify("remove the text in the corner"), ["extra_text"]);
assert.ok(classify("her hand has six fingers").includes("hands_bodies"));
assert.ok(classify("The bottle looks different from mine").includes("product_changed"));
assert.ok(classify("where is the dog? I asked for a dog").includes("missing_item"));
assert.ok(classify("the man walks through the table").includes("motion_physics"));
assert.ok(classify("the car disappears at the end").includes("vanishing"));
assert.ok(classify("it looks too fake and plastic").includes("looks_fake"));
assert.ok(classify("make it less blurry").includes("blurry"));
assert.ok(classify("his head is cut off").includes("framing"));
// The checker's fault codes map straight across.
assert.deepEqual(classify("", ["unwanted_speech"]), ["unwanted_speech"]);
// Taste is not a problem we learn from.
assert.deepEqual(classify("make it more joyful please"), []);
assert.ok(classify("a b c hands blurry misspelled fake cut off missing").length <= 3);

// ---- Reports keep the pattern, not the person ----
const now = new Date("2026-11-24T12:00:00Z");
const e1 = toEvent({ source: "fix", kind: "image", model: "fal-ai/flux/schnell", result: "res-123456", note: "the words are misspelled" }, "who1", now)!;
assert.deepEqual(e1.problems, ["garbled_text"]);
assert.equal(e1.note, undefined, "matched notes are not kept at all");
const e2 = toEvent({ source: "fix", kind: "image", model: "m", result: "res-abcdef", note: "make it like my email bob@example.com or call +1 (555) 123-4567 https://x.co" }, "who1", now)!;
assert.deepEqual(e2.problems, []);
assert.ok(e2.note && !e2.note.includes("bob@") && !e2.note.includes("555") && !e2.note.includes("x.co"), String(e2.note));
assert.equal(toEvent({ source: "hack", kind: "image", result: "res-123456" }, "w", now), null);
assert.equal(toEvent({ source: "fix", kind: "image", result: "../../x" }, "w", now), null);
assert.deepEqual(toEvent({ source: "made", kind: "video", model: "m", result: "res-999999", note: "misspelled" }, "w", now)!.problems, []);
assert.ok(scrub("x".repeat(500)).length <= 160);

// ---- Spotting a pattern: enough reports from enough different people ----
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
const ev = (over: Partial<FeedbackEvent>): FeedbackEvent => ({ at: at(1), source: "fix", kind: "image", model: "m1", problems: ["garbled_text"], who: "a", result: Math.random().toString(36), ...over });

// One person, many reports: never suggested.
const onePerson = Array.from({ length: 20 }, () => ev({ who: "same" }));
let s = summarize(onePerson, EMPTY_SETTINGS, now.getTime());
assert.equal(s.rules.find((r) => r.id === ruleId("garbled_text", "image"))!.status, "waiting");

// Enough people: suggested, but not on until the owner says so.
const many = Array.from({ length: MIN_REPORTS }, (_, i) => ev({ who: `p${i % MIN_PEOPLE}` }));
s = summarize(many, EMPTY_SETTINGS, now.getTime());
const g = s.rules.find((r) => r.id === ruleId("garbled_text", "image"))!;
assert.equal(g.status, "suggested");
assert.equal(s.rules[0].id, g.id, "suggestions come first");
assert.equal(activeLessons(EMPTY_SETTINGS, "image").length, 0);

// The same result counted once, even if it was checked and then fixed.
const dup = [ev({ result: "r1", source: "check" }), ev({ result: "r1", source: "find" })];
assert.equal(summarize(dup, EMPTY_SETTINGS, now.getTime()).problems[0].reports, 1);

// Old reports drop out of the window.
assert.equal(summarize([ev({ at: at(90) })], EMPTY_SETTINGS, now.getTime()).problems.length, 0);

// "Not now" keeps it out of the suggestions.
const skipped: LearnSettings = { rules: { [g.id]: { on: false, at: at(0), skipped: true } }, custom: [] };
assert.equal(summarize(many, skipped, now.getTime()).rules.find((r) => r.id === g.id)!.status, "off");

// ---- Applying: only our written rule text goes into the booster ----
const onSettings: LearnSettings = {
  rules: { [g.id]: { on: true, at: at(10) }, [ruleId("vanishing", "video")]: { on: true, at: at(10) } },
  custom: [{ id: "custom-x", kind: "image", text: "Keep product photos on a plain light background.", on: true, at: at(5) }],
};
const imgLessons = activeLessons(onSettings, "image");
assert.deepEqual(imgLessons.map((l) => l.id), [g.id, "custom-x"]);
const block = lessonsBlock(imgLessons);
assert.ok(block.includes(catalogue().find((r) => r.id === g.id)!.text));
assert.ok(!block.includes("SUMMR"), "user words never reach the booster");
assert.equal(lessonsBlock([]), "");
const vidLessons = activeLessons(onSettings, "video");
assert.ok(mergeAvoid("blur, text", vidLessons)!.includes("disappearing"));
assert.equal(mergeAvoid("blur", []), "blur");

// The simple fallback booster gets the short hint; without rules it's unchanged.
const img = MODELS.find((m) => m.kind === "image" && !m.needsSource)!;
assert.equal(enhanceWithRules("a red mug", img), enhanceWithRules("a red mug", img, true, []));
assert.ok(enhanceWithRules("a red mug", img, true, imgLessons).includes("spelled exactly"));
const vid = MODELS.find((m) => m.kind === "video" && !m.needsSource && !m.takesImage)!;
assert.ok(getModel(vid.id));
void (async () => {
  const viaRules = await enhancePrompt("a car driving", vid, { live: false, lessons: vidLessons });
  assert.ok(viaRules.avoid!.includes("disappearing"));
  const plain = await enhancePrompt("a car driving", vid, { live: false });
  assert.ok(!plain.avoid!.includes("disappearing"));
})();

// ---- Measuring: before vs since, only once there are enough results ----
const ruleOnAt = at(10);
const before: FeedbackEvent[] = [];
const after: FeedbackEvent[] = [];
for (let i = 0; i < MIN_RESULTS_TO_COMPARE * 2; i++) {
  before.push(ev({ at: at(20), source: "made", problems: [], result: `b${i}` }));
  if (i % 4 === 0) before.push(ev({ at: at(20), result: `b${i}`, who: `x${i}` })); // 25 in 100
  after.push(ev({ at: at(5), source: "made", problems: [], result: `a${i}`, lessons: [g.id] }));
  if (i % 20 === 0) after.push(ev({ at: at(5), result: `a${i}`, lessons: [g.id], who: `y${i}` })); // 5 in 100
}
let m = summarize([...before, ...after], { rules: { [g.id]: { on: true, at: ruleOnAt } }, custom: [] }, now.getTime()).rules.find((r) => r.id === g.id)!;
assert.equal(m.status, "on");
assert.equal(m.before!.rate, 25);
assert.equal(m.after!.rate, 5);
assert.match(m.verdict!, /helping/);
// Too few results: we say so instead of claiming anything.
m = summarize([...before, ...after.slice(0, 6)], { rules: { [g.id]: { on: true, at: ruleOnAt } }, custom: [] }, now.getTime()).rules.find((r) => r.id === g.id)!;
assert.match(m.verdict!, /Not enough results/);

console.log("learn tests passed");
