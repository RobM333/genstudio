import assert from "node:assert/strict";
import { nextLength, readChat } from "../lib/chat";

assert.deepEqual(readChat("find what's wrong", "image"), { type: "check" });
assert.deepEqual(readChat("Can you check it for mistakes?", "video"), { type: "check" });
assert.deepEqual(readChat("make it 15 seconds", "video"), { type: "length", seconds: 15 });
assert.deepEqual(readChat("20s", "video"), { type: "length", seconds: 20 });
assert.deepEqual(readChat("make it longer", "video"), { type: "length", seconds: null });
assert.deepEqual(readChat("add sound", "video"), { type: "sound" });
assert.deepEqual(readChat("turn it into a video", "image"), { type: "video" });
assert.deepEqual(readChat("Make the final version", "image"), { type: "final" });
assert.deepEqual(readChat("make it brighter", "image"), { type: "fix", note: "make it brighter" });
assert.deepEqual(readChat('the text should say "SALE"', "image"), { type: "fix", note: 'the text should say "SALE"' });
// Numbers that aren't a length stay a fix.
assert.equal(readChat("8 seconds after he jumps the dog barks", "video").type, "fix");
assert.equal(readChat("put 3 apples on the table", "video").type, "fix");
// "make it longer hair" is a fix, long sentences aren't length requests.
assert.equal(readChat("the woman on the left should have her hair longer and darker and wavy like in the first one", "image").type, "fix");
assert.equal(nextLength(5, [15, 20, 30]), 15);
assert.equal(nextLength(15, [15, 20, 30]), 20);
assert.equal(nextLength(30, [15, 20, 30]), 30);
console.log("chat tests passed");
