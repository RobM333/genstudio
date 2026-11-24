import assert from "node:assert/strict";
import { asksForSpeech, cleanFaults, decide, isRealSpeech, MONTHLY_CAP, usedInMonth, type CreditEntry } from "../lib/promise";
import { parseAnalysis } from "../lib/analyze";

// Failed jobs: always credits back, whatever the monthly count.
assert.deepEqual(decide({ failed: true, usedThisMonth: 99 }).type, "refund");

// A clear fault from the check: credits back, until the monthly limit.
const garbled = { problems: ["The sign says SUMMR SAEL."], faults: ["garbled_text"], serious: true };
const r = decide({ check: garbled, usedThisMonth: 0 });
assert.equal(r.type, "refund");
assert.equal(r.type === "refund" && r.fault, "garbled_text");
assert.equal(decide({ check: garbled, usedThisMonth: MONTHLY_CAP }).type, "capped");

// Serious but not on the list: a free remake, not a refund.
assert.equal(decide({ check: { problems: ["The hand has six fingers."], faults: [], serious: true }, usedThisMonth: 0 }).type, "free_remake");
// Small or no problems: nothing.
assert.equal(decide({ check: { problems: ["Slightly warm colours."], serious: false }, usedThisMonth: 0 }).type, "none");
assert.equal(decide({ check: null, usedThisMonth: 0 }).type, "none");

// Only covered codes count; "failed" can't come from the check.
assert.deepEqual(cleanFaults(["garbled_text", "ugly", "failed", "garbled_text", "missing_item"]), ["garbled_text", "missing_item"]);

// The checker's reply: faults need a written problem, and make it serious.
const a = parseAnalysis(JSON.stringify({ problems: ["The bottle turns from blue to red."], faults: ["product_changed"], serious: false, fix: "x", prompt: "y" }));
assert.equal(a?.serious, true);
assert.deepEqual(a?.faults, ["product_changed"]);
const b = parseAnalysis(JSON.stringify({ problems: [], faults: ["garbled_text"], prompt: "y" }));
assert.deepEqual(b?.faults, []);

// Did they ask for speech?
assert.equal(asksForSpeech("A surfer rides a wave at sunset, with ocean sounds"), false);
assert.equal(asksForSpeech('A chef says "dinner is ready"'), true);
assert.equal(asksForSpeech("A presenter talks to camera about the new phone"), true);

// Speech-to-text "hears" short phantom phrases on music: they don't count.
assert.equal(isRealSpeech(""), false);
assert.equal(isRealSpeech("Thank you."), false);
assert.equal(isRealSpeech("[Music] ♪"), false);
assert.equal(isRealSpeech("Hey, come over here and look at this"), true);

// The monthly count: check refunds and free remakes count, failed jobs don't, last month doesn't.
const now = new Date(2026, 10, 24).getTime();
const last = new Date(2026, 9, 30).getTime();
const log: CreditEntry[] = [
  { at: now, itemId: "1", type: "returned", credits: 70, what: "x", fault: "garbled_text" },
  { at: now, itemId: "2", type: "returned", credits: 70, what: "x", fault: "failed" },
  { at: now, itemId: "3", type: "free_remake", credits: 0, what: "x" },
  { at: last, itemId: "4", type: "returned", credits: 70, what: "x", fault: "missing_item" },
  { at: now, itemId: "5", type: "used", credits: 70, what: "x" },
];
assert.equal(usedInMonth(log, now), 2);

console.log("promise tests passed");
