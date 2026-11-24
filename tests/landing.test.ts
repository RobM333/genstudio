import assert from "node:assert/strict";
import { dealColumns, makeLink, templateLink, WALL, wallIn } from "../lib/landing";
import { TEMPLATES } from "../lib/templates";

// The wall: only files from the showcase folder, no repeats, a video first.
assert.ok(WALL.length >= 12, "the wall needs enough examples to look full");
assert.equal(new Set(WALL.map((w) => w.src)).size, WALL.length, "no example twice");
assert.equal(WALL[0].kind, "video", "the most eye-catching example (a video) comes first");
for (const w of WALL) {
  assert.ok(w.src.startsWith("/showcase/"), w.src);
  assert.equal(w.kind === "video", w.src.endsWith(".mp4"), w.src);
  if (w.template) assert.ok(TEMPLATES.some((t) => t.id === w.template), `unknown template ${w.template}`);
}

// Filters keep the wall's order.
assert.deepEqual(wallIn("all"), WALL);
assert.ok(wallIn("business").every((w) => w.group === "business"));
assert.ok(wallIn("video").length >= 1);

// Columns: every example lands in exactly one column, and columns are mixed.
const cols = dealColumns(WALL, 5);
assert.equal(cols.length, 5);
assert.equal(cols.flat().length, WALL.length);
assert.deepEqual(new Set(cols.flat()), new Set(WALL));
assert.deepEqual(dealColumns([1, 2, 3], 1), [[1, 2, 3]]);
assert.deepEqual(dealColumns([], 3), [[], [], []]);

// While the studio is closed, buttons lead to the founding sign-up.
assert.equal(makeLink({ template: "product-hero" }, false), "/founding#claim");
assert.equal(templateLink("product-hero", false), "/founding#claim");
// Once it opens, they go straight into the studio.
assert.equal(makeLink({ template: "product-hero" }, true), "/studio?template=product-hero");
assert.equal(makeLink({}, true), "/studio?view=create");
assert.equal(templateLink("story-ad", true), "/studio?template=story-ad");

console.log("landing tests passed");
