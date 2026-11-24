import assert from "node:assert/strict";
import { autoSize, choiceById, emptyShot, filmCost, framePrompt, motionPrompt, MOVES, shapesFor, shotSecondsFor, LIGHTS, LOOKS, SHOT_SIZES, ANGLES, LENSES, FILM_VIDEO_MODELS } from "../lib/filmset";
import { characterRefs, checkCharacter, promptName, sheetPrompt } from "../lib/characters";
import { refName, sceneInstructions, referenceInstructions } from "../lib/references";
import { checkPrompt } from "../lib/safety";
import { getModel, animateModelFor } from "../lib/models";

// Every list starts with Auto, has unique ids, and every real choice has prompt words.
for (const list of [SHOT_SIZES, ANGLES, LENSES, MOVES, LIGHTS, LOOKS]) {
  assert.equal(list[0].id, "auto");
  assert.equal(new Set(list.map((c) => c.id)).size, list.length);
  for (const c of list.slice(1)) {
    assert.ok(c.phrase.length > 8, c.id);
    assert.ok(c.label.length <= 18, `${c.label} is short enough for a card`);
    assert.ok(checkPrompt(c.phrase).ok);
  }
}
assert.equal(choiceById(MOVES, "nope").id, "auto");

// Auto shot sizes go wide, then closer.
assert.match(autoSize(0, 3, false), /wide/);
assert.match(autoSize(2, 3, false), /close-up/);
assert.equal(autoSize(0, 1, false), "");
assert.equal(autoSize(0, 3, true), "");

const scene = { setting: "a rooftop café at dusk", light: "golden", look: "film" };
const cast = [{ id: "a", name: "Mia", look: "woman in her late 20s, curly black hair", outfit: "mustard jumper" }];
const shot = { ...emptyShot(), action: "Mia walks onto the rooftop.", angle: "low", lens: "portrait", move: "orbit" };

// The picture prompt keeps the user's choices, the cast and their outfit, but never a camera move.
const fp = framePrompt({ shot, scene, cast, i: 0, n: 3, still: false });
assert.match(fp, /Director's choices:/);
assert.match(fp, /low angle/);
assert.match(fp, /85mm/);
assert.match(fp, /golden hour/);
assert.match(fp, /35mm film/);
assert.match(fp, /Mia \(woman in her late 20s, curly black hair\), wearing mustard jumper/);
assert.match(fp, /wide establishing/); // auto size for shot 1 of 3
assert.doesNotMatch(fp, /circles/);
assert.match(fp, /Shot 1 of 3/);
assert.ok(fp.length <= 1800);
// One frame says so.
assert.match(framePrompt({ shot, scene, cast: [], i: 0, n: 1, still: true }), /One single frame/);

// The motion prompt has the camera move, keeps faces and outfits.
const mp = motionPrompt({ shot, scene, cast, i: 1, n: 3 });
assert.match(mp, /Camera: the camera circles/);
assert.match(mp, /Same character, faces and outfits/);
assert.ok(checkPrompt(fp).ok && checkPrompt(mp).ok);

// Lengths and shapes follow what each model really makes.
assert.equal(shotSecondsFor("fal-ai/minimax/hailuo-02/standard/text-to-video", 5), 6);
assert.equal(shotSecondsFor("fal-ai/kling-video/v2.5-turbo/pro/text-to-video", 10), 10);
assert.equal(shotSecondsFor("fal-ai/veo3/fast", 5), 4);
assert.ok(!shapesFor("fal-ai/veo3/fast").includes("1:1"));
for (const m of FILM_VIDEO_MODELS) {
  assert.ok(getModel(m.id), m.id);
  assert.ok(animateModelFor(m.id).takesImage, m.id);
}

// Cost: more shots cost more, sound and new looks add a little, one frame is cheap.
const base = { still: false, shots: 3, videoModelId: FILM_VIDEO_MODELS[0].id, seconds: 5, sound: false, cast: 1, newLooks: 0 };
const c3 = filmCost(base);
assert.ok(c3 > filmCost({ ...base, shots: 2 }));
assert.ok(filmCost({ ...base, sound: true }) > c3);
assert.ok(filmCost({ ...base, newLooks: 1 }) > c3);
assert.ok(filmCost({ ...base, still: true }) < 0.2);
assert.ok(c3 > 0.5 && c3 < 2, `3 Kling shots of 5s about $1.20, got ${c3}`);

// Characters: invented adults or consented people, never lookalikes or children.
assert.deepEqual(checkCharacter({ name: "Mia", look: "woman in her late 20s, curly hair", outfit: "" }), { ok: true });
assert.equal(checkCharacter({ name: "", look: "a man", outfit: "" }).ok, false);
assert.equal(checkCharacter({ name: "Taylor Alison Swift", look: "singer", outfit: "" }).ok, false);
assert.equal(checkCharacter({ name: "Sam", look: "looks like a famous actor", outfit: "" }).ok, false);
assert.equal(checkCharacter({ name: "Sam", look: "a lookalike of a footballer", outfit: "" }).ok, false);
assert.equal(checkCharacter({ name: "Sam", look: "a 16 year old student", outfit: "" }).ok, false);
assert.equal(checkCharacter({ name: "Sam", look: "a teenage boy", outfit: "" }).ok, false);
assert.equal(checkCharacter({ name: "Coach Dan", look: "man in his 50s, grey beard", outfit: "tracksuit" }).ok, true);
assert.equal(promptName("Coach Dan"), "Coach");
assert.equal(promptName("  Mia!  "), "Mia");
assert.match(sheetPrompt({ look: "woman, curly hair", outfit: "red coat" }, false), /invented adult person: woman, curly hair\. Wearing red coat/);
assert.match(sheetPrompt({ look: "", outfit: "" }, true), /person in Image 1/);
assert.deepEqual(
  characterRefs([
    { id: "1", name: "Mia", look: "", outfit: "", createdAt: 0, sheetUrl: "u", sheetToken: "t" },
    { id: "2", name: "Ben", look: "", outfit: "", createdAt: 0 },
  ]),
  [{ url: "u", kind: "person", token: "t", name: "Mia" }],
);

// Reference wording names saved characters, and a later shot keeps the same place.
assert.match(referenceInstructions(["person", "person"], 0, ["Mia", "Ben"]), /Image 1 is Mia, a person to feature.*Image 2 is Ben/);
assert.match(referenceInstructions(["person"]), /Image 1 is the person to feature/);
assert.match(sceneInstructions(["person"], ["Mia"]), /^Image 1 is an earlier frame of this same scene.*Image 2 is Mia/);
assert.equal(refName("Mia Rose"), "Mia");
assert.equal(refName(5), undefined);

console.log("filmset tests passed");
