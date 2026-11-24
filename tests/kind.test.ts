import assert from "node:assert/strict";
import { guessKind } from "../lib/kind";

const k = (p: string) => guessKind(p)?.kind ?? null;

// Named outright
assert.equal(k("A 10 second video of coffee being poured"), "video");
assert.equal(k("product photo of a perfume bottle on marble"), "image");
assert.equal(k("Instagram reel for my bakery"), "video");
assert.equal(k("logo for a dog grooming shop"), "image");
assert.equal(k("YouTube thumbnail with the words BIG SALE"), "image");
// Both named: the first wins
assert.equal(k("a video made from my product photos"), "video");
assert.equal(k("a photo to use as the cover of my reel"), "image");
// Only a video can do it
assert.equal(k("slow motion splash of milk into a bowl of cereal"), "video");
assert.equal(k("camera pans across a sunny vineyard at golden hour"), "video");
assert.equal(k("a chef talking to the camera about pasta"), "video");
assert.equal(k("Wide shot of a beach, cut to a close-up of a shell."), "video");
assert.equal(k("a flower bud that begins to open"), "video");
assert.equal(k("waves on a beach, 8s"), "video");
// No clear signal: keep whatever is chosen
assert.equal(k("a red apple on a wooden table"), null);
assert.equal(k("a woman walking in Paris at night"), null);
assert.equal(k("cat"), null);
assert.equal(k("portrait of a man, shot on 35mm film, grain"), "image");
assert.equal(k("a commercial kitchen with steel benches"), null);
assert.equal(k("a red car with mountains in the background"), null);
// Not fooled by look-alike words
assert.equal(k("a clipboard on a desk"), null);
assert.equal(k("a filmy curtain in the wind"), null);
assert.equal(guessKind("A 5 second clip of rain")?.why, 'you said "clip"');

console.log("kind tests passed");
