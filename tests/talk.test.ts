import assert from "node:assert/strict";
import { checkConsent, consentSentence, newCode, setupCost, speechLanguage, talkCost, talkSeconds } from "../lib/talk";
import { creditsFor } from "../lib/pricing";
import { judgeRefCheck } from "../lib/references";

// The consent sentence must be heard, with the code, from one speaker.
const code = "4729";
const sentence = consentSentence(code);
assert.ok(sentence.includes("4 7 2 9"));
assert.deepEqual(checkConsent(sentence + " The best part of my week...", code), { ok: true });
assert.deepEqual(checkConsent("I am recording my own voice for ToastyFly and I agree to it making a copy of my voice. My code is 4729.", code), { ok: true });
assert.deepEqual(checkConsent("I am recording my own voice for ToastyFly, and I agree to it making a copy of my voice. My code is four seven two nine.", code), { ok: true });
assert.deepEqual(checkConsent("I am recording my own voice for ToastyFly and I agree to it making a copy of my voice. My code is 4,729.", code), { ok: true });
assert.equal(checkConsent("I am recording my own voice. My code is 4 7 2 9.", code).ok, false); // no agreement
assert.equal(checkConsent(sentence.replace("4 7 2 9", "1 2 3 4"), code).ok, false); // wrong code
assert.equal(checkConsent(sentence, code, 2).ok, false); // two people
assert.equal(checkConsent("", code).ok, false);
assert.match(newCode(() => 0.5), /^\d{4}$/);

// Timing and cost.
assert.equal(talkSeconds(""), 0);
assert.equal(talkSeconds("one two three"), 3);
assert.equal(talkSeconds(Array(50).fill("word").join(" ")), 20);
assert.equal(talkSeconds("あ".repeat(50), "Japanese"), 10);
assert.ok(talkCost(15) > 1.7 && talkCost(15) < 1.8, `15s talking video ${talkCost(15)}`);
assert.ok(setupCost() > 1.5 && setupCost() < 1.6, `setup ${setupCost()}`);
// Credits earn at least twice what a job costs us.
assert.ok(creditsFor(talkCost(15)) * 0.024 >= talkCost(15) * 2);
assert.equal(speechLanguage("Spanish"), "Spanish");
assert.equal(speechLanguage("Tamil"), "auto");

// Public figures can't be used as a person picture.
assert.equal(judgeRefCheck('{"minor":false,"nudity":false,"gore":false,"people":1,"matches":true,"famous":true}', "person").ok, false);
assert.equal(judgeRefCheck('{"minor":false,"nudity":false,"gore":false,"people":1,"matches":true,"famous":false}', "person").ok, true);
assert.equal(judgeRefCheck('{"minor":false,"nudity":false,"gore":false,"people":0,"matches":true,"famous":true}', "product").ok, true);

console.log("talk tests passed");
