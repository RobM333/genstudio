import assert from "node:assert/strict";
import { AD_PRICES, AD_VOICES, adCost, endCardPrompt, nativeTalk, sceneVideoCost, talkScenePrompt, voiceInWords, frameLead, NO_TEXT, adPlanWithRules, endCardSeconds, fitLine, parseAdPlan, sceneCount, scenePrompt, speaksOnScreen, wantsOnScreenText, withoutDialogue } from "../lib/adplan";
import { judgeRefCheck, referenceInstructions } from "../lib/references";
import { parseAnalysis } from "../lib/analyze";
import { barsIn, cardLength, changedAdJob, newAdJob } from "../components/adRunner";

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
assert.ok(c > 0.95 && c < 1.05, String(c));

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
// Lines said on screen: the planner marks them, the lips are matched, and the price follows the line's length.
const talkRaw = JSON.stringify({
  title: "Toasty",
  concept: "c",
  look: "toast in sunglasses",
  music: "fun",
  voice: "Roger",
  scenes: [
    { visual: 'Toasty shouts "Quiet on set! Aaand... action!" into a megaphone on a film set', camera: "medium", text: "", voice: "Quiet on set! Aaand... action!", speaker: "character" },
    { visual: "Toasty leans to camera", camera: "close-up", text: "", voice: "You could direct your own movie. Just get ToastyFly.", speaker: "character" },
  ],
  endCard: { headline: "ToastyFly", tagline: "Direct your own movie", voice: "ToastyFly." },
});
const talk = parseAdPlan(talkRaw, { ...brief, refKinds: ["character"], refNames: ["Toasty"] })!;
assert.ok(talk.scenes.every(speaksOnScreen));
// A real person's photo is never made to say words in one of our voices.
const withPerson = parseAdPlan(talkRaw, { ...brief, refKinds: ["person"] })!;
assert.ok(!withPerson.scenes.some(speaksOnScreen));
// Spoken words are taken out of the picture description, so no speech bubble is drawn.
assert.equal(withoutDialogue('Toasty shouts "Quiet on set!" into a megaphone.'), "Toasty shouts into a megaphone");
const sp = scenePrompt(talk, 0);
assert.ok(!sp.includes("Quiet on set"), sp);
assert.ok(/speech bubbles/i.test(sp) && /black bars/i.test(sp), sp);
assert.ok(/Nobody on screen talks/.test(scenePrompt(plan, 0)));
assert.ok(!wantsOnScreenText("a toast mascot ad") && wantsOnScreenText("add captions please"));
const talkCost = adCost(talk, true);
const asVoiceover = adCost({ ...talk, scenes: talk.scenes.map((x) => ({ ...x, speaker: "voiceover" as const })) }, true);
assert.ok(talkCost > asVoiceover && talkCost - asVoiceover < 2 * (5 * AD_PRICES.nativeTalkPerSecond), `${talkCost} ${asVoiceover}`);

// Kling 3 says the line in one step for our voices in English; the user's own voice or another language keeps lip matching.
assert.ok(nativeTalk("Roger") && nativeTalk("Roger", "English") && !nativeTalk("Roger", "Spanish") && !nativeTalk("el:abcdefgh12"));
assert.equal(voiceInWords("Roger"), "a relaxed male American voice");
assert.equal(voiceInWords("nobody"), "a warm female American voice");
const tp = talkScenePrompt({ ...talk, voice: "Roger" }, 0);
assert.ok(tp.includes(`"${talk.scenes[0].voice.trim().replace(/["“”]/g, "'")}"`) && tp.includes("a relaxed male American voice") && /speech bubbles/i.test(tp), tp);
const s0 = talk.scenes[0];
const native = sceneVideoCost(s0, "English", "Roger");
assert.ok(native >= 0.5 && native <= 1.0, String(native));
assert.ok(Math.abs(sceneVideoCost(s0, "Spanish", "Roger") - native) > 1e-9);

// Voice lines are never cut mid-sentence.
assert.equal(fitLine("You could direct your own movie. Just get ToastyFly.", 5), "You could direct your own movie. Just get ToastyFly.");
assert.equal(fitLine("You could direct your own movie today. Just get ToastyFly and start filming tonight with friends.", 5), "You could direct your own movie today.");
const longOne = fitLine("This one very long sentence goes on and on without any stop at all because it keeps going forever", 5);
assert.ok(longOne.endsWith(".") && longOne.split(" ").length <= 10, longOne);

// Voices say their accent, and the default is American.
assert.ok(AD_VOICES.every((v) => v.label.includes(v.accent)));
assert.equal(AD_VOICES.find((v) => v.id === "Charlie")?.accent, "Australian");
assert.equal(parseAdPlan(raw.replace('"Brian"', '"Nobody"'), brief)!.voice, "Rachel");

// Characters and mascots skip the face check, but real people and famous characters can't come in that way.
const ok = '{"minor":false,"nudity":false,"gore":false,"people":0,"matches":true,"famous":false,"real_person_photo":false,"known_character":false}';
assert.deepEqual(judgeRefCheck(ok, "character"), { ok: true });
assert.equal(judgeRefCheck(ok, "person").ok, false);
assert.equal(judgeRefCheck(ok.replace('"real_person_photo":false', '"real_person_photo":true'), "character").ok, false);
assert.equal(judgeRefCheck(ok.replace('"known_character":false', '"known_character":true'), "character").ok, false);
assert.ok(referenceInstructions(["character"], 0, ["Toasty"]).includes("Toasty, the user's own character"));

// A "garbled words" finding with no letters actually seen is dropped.
const ghost = parseAnalysis('{"problems":["The sign has garbled words."],"seen_text":"","faults":["garbled_text"],"serious":true,"fix":"x","prompt":"p"}')!;
assert.equal(ghost.problems.length, 0);
assert.equal(ghost.serious, false);
assert.deepEqual(ghost.faults, []);
const real = parseAnalysis('{"problems":["The sign has garbled words."],"seen_text":"SUMR SAEL","faults":["garbled_text"],"serious":true,"fix":"x","prompt":"p"}')!;
assert.deepEqual(real.faults, ["garbled_text"]);
// Talking scenes are shorter, so the end card holds a little longer (at most 2 extra seconds).
assert.equal(cardLength(plan, [5, 5]), 5);
assert.equal(cardLength(plan, [2.7, 3.2]), 7);
assert.equal(cardLength(plan, [4.5, 4]), 6.5);
console.log("ad plan tests passed");

// Opening frames treat a mascot as a character, not as "the product".
{
  assert.match(frameLead(["character"]), /character from the reference/);
  assert.doesNotMatch(frameLead(["character"]), /product must look/);
  assert.match(frameLead([]), /product must look/);
  assert.match(NO_TEXT, /director's chair back is plain/);
}

// Black bars: a letterboxed frame is spotted from its pixels, a normal or dark-centred one isn't.
{
  const w = 10, h = 20;
  const pic = (bars: boolean) => {
    const px: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = bars && (y < 3 || y >= h - 3) ? 0 : 120;
      px.push(v, v, v, 255);
    }
    return px;
  };
  assert.ok(barsIn(pic(true), w, h));
  assert.ok(!barsIn(pic(false), w, h));
}
// The end card keeps a character's own outfit.
assert.match(endCardPrompt(plan, true, undefined, ["character"]), /same outfit/);
assert.match(endCardPrompt(plan, true, undefined, ["product"]), /product from the reference/);
assert.match(frameLead(["character"]), /never standing on top of furniture/);
console.log("bars and end card tests passed");
