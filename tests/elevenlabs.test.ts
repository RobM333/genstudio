import assert from "node:assert/strict";
import { elevenError, isMp3, isOwnVoice, looksLikeKey, needsConsent, ownVoiceId, parseVoices, ttsBody } from "../lib/elevenlabs";
import { adCost, adPlanWithRules, parseAdPlan, AD_LANGUAGES } from "../lib/adplan";

assert.equal(isOwnVoice("el:21m00Tcm4TlvDq8ikWAM"), true);
assert.equal(isOwnVoice("Rachel"), false);
assert.equal(isOwnVoice("el:../../x"), false);
assert.equal(ownVoiceId("el:21m00Tcm4TlvDq8ikWAM"), "21m00Tcm4TlvDq8ikWAM");

assert.equal(needsConsent("cloned"), true);
assert.equal(needsConsent("professional"), true);
assert.equal(needsConsent("premade"), false);
assert.equal(needsConsent("generated"), false);

assert.deepEqual(parseVoices({ voices: [{ voice_id: "abcdefgh12", name: " Brand ", category: "cloned" }, { voice_id: "bad id", name: "x" }] }), [
  { id: "abcdefgh12", name: "Brand", category: "cloned" },
]);
assert.deepEqual(parseVoices(null), []);

// Every voiceover language works with a connected voice.
for (const l of AD_LANGUAGES) assert.ok(String(ttsBody("Hi", l).model_id).startsWith("eleven_"));
assert.equal(ttsBody("Hei", "Norwegian").model_id, "eleven_turbo_v2_5");
assert.equal(ttsBody("Hei", "Norwegian").language_code, "no");
assert.equal(ttsBody("Hola", "Spanish").model_id, "eleven_multilingual_v2");

assert.equal(looksLikeKey("sk_" + "a".repeat(40)), true);
assert.equal(looksLikeKey("hello there"), false);
assert.equal(isMp3(new Uint8Array([0x49, 0x44, 0x33, 4])), true);
assert.equal(isMp3(new Uint8Array([0xff, 0xfb, 0x90, 0])), true);
assert.equal(isMp3(new Uint8Array([0x3c, 0x68, 0x74, 0x6d])), false);
assert.match(elevenError(401), /key/);
assert.match(elevenError(401, '{"detail":{"status":"quota_exceeded"}}'), /out of characters/);

// A connected voice costs us nothing, so it isn't in the ad's price.
const brief = { product: "a candle", audience: "people", seconds: 15, tone: "Calm" };
const plan = adPlanWithRules(brief);
assert.ok(adCost({ ...plan, voice: "el:abcdefgh12" }, false) < adCost(plan, false));

// Changing a plan keeps the user's own voice unless the planner picks one of ours.
const raw = (voice: string) => JSON.stringify({ ...plan, voice });
assert.equal(parseAdPlan(raw("el:abcdefgh12"), brief, "el:abcdefgh12")?.voice, "el:abcdefgh12");
assert.equal(parseAdPlan(raw("something"), brief, "el:abcdefgh12")?.voice, "el:abcdefgh12");
assert.equal(parseAdPlan(raw("Brian"), brief, "el:abcdefgh12")?.voice, "Brian");
assert.equal(parseAdPlan(raw("el:abcdefgh12"), brief)?.voice, "Rachel");
console.log("elevenlabs tests passed");
