import assert from "node:assert/strict";
import { directorInstructions, directorWithRules, parseDirector } from "../lib/director";

const r = parseDirector(
  'ok {"read":"A launch clip","questions":["Who is it for?","",3],"directions":[{"name":"Hero","why":"Premium","prompt":"A 50mm medium shot of a steel kettle on a marble counter, slow push-in, warm light from the left.","seconds":12,"shape":"9:16"},{"name":"Short","prompt":"too short"},{"name":"Bad shape","prompt":"A wide shot of a kettle pouring water into a cup, steam rising, morning light from a window.","seconds":40,"shape":"4:5"}]}',
  "video",
);
assert.ok(r);
assert.equal(r.directions.length, 2);
assert.equal(r.directions[0].seconds, 10);
assert.equal(r.directions[0].shape, "9:16");
assert.equal(r.directions[1].seconds, 30);
assert.equal(r.directions[1].shape, "16:9");
assert.deepEqual(r.questions, ["Who is it for?"]);
assert.equal(parseDirector("no json", "video"), null);
assert.equal(parseDirector('{"directions":[]}', "video"), null);
assert.equal(parseDirector('{"directions":[{"prompt":"A product photo of a kettle on a marble counter, soft light from the left, clean background.","seconds":10}]}', "image")?.directions[0].seconds, 0);

const rules = directorWithRules("A kettle boiling in a sunny kitchen.", "video", { name: "Brew", colors: ["#1f3a7a"] });
assert.equal(rules.directions.length, 3);
assert.ok(rules.directions[0].prompt.startsWith("A kettle boiling in a sunny kitchen. 50mm"));
assert.match(rules.directions[0].prompt, /navy/);
assert.match(directorInstructions("video", { name: "Brew" }), /brand kit: Brand name: Brew/);
assert.doesNotMatch(directorInstructions("image"), /camera move/);
console.log("director tests passed");
