import assert from "node:assert/strict";
import { describesSeveralShots, firstShot } from "../lib/shots";
import { pickModel } from "../lib/router";

const ferrari =
  "18mm extreme low angle, capturing the full width of the front bumper of a powerful red sports car, tires slightly smoking as it begins to accelerate on a winding mountain road. The shot then cuts to an aerial wide shot, looking down at the car as it carves a dramatic, tight curve on a cliffside road, leaving a slight dust trail. The surrounding landscape features jagged peaks. Overcast, dramatic lighting creating a mood of raw power, with a cool, intense color palette.";
assert.equal(describesSeveralShots(ferrari), true);
assert.equal(
  firstShot(ferrari),
  "18mm extreme low angle, capturing the full width of the front bumper of a powerful red sports car, tires slightly smoking as it begins to accelerate on a winding mountain road. Overcast, dramatic lighting creating a mood of raw power, with a cool, intense color palette.",
);
assert.equal(describesSeveralShots("A red car on a mountain road at sunset, then the camera is low"), false);
assert.equal(describesSeveralShots("A cut of beef on a wooden board"), false);
assert.equal(describesSeveralShots("Wide shot of a beach, cut to a close-up of a shell."), true);
assert.equal(firstShot("Wide shot of a beach, cut to a close-up of a shell."), "Wide shot of a beach.");

// Auto: short ideas use the cheapest model, detailed ones a model that follows them.
assert.equal(pickModel({ kind: "image", prompt: "a red apple on a table", quality: "draft", aspectRatio: "16:9" }).model.id, "fal-ai/flux/schnell");
assert.equal(pickModel({ kind: "image", prompt: ferrari, quality: "draft", aspectRatio: "16:9" }).model.id, "fal-ai/nano-banana");
assert.equal(pickModel({ kind: "image", prompt: "35mm low angle close-up of a watch on a wrist, light from the left", quality: "draft", aspectRatio: "16:9" }).model.id, "fal-ai/nano-banana");
console.log("shot tests passed");
