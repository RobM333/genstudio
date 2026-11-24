import assert from "node:assert/strict";
import { brandValues, coverCrop, fillTemplate, sizeLabel, templateByName, templatesIn, TEMPLATES, TEMPLATE_CATEGORIES } from "../lib/templates";

// Every template is in a known group, has a unique id and name, and sized ones are pictures.
const ids = new Set(TEMPLATES.map((t) => t.id));
assert.equal(ids.size, TEMPLATES.length);
assert.equal(new Set(TEMPLATES.map((t) => t.name)).size, TEMPLATES.length);
for (const t of TEMPLATES) {
  assert.ok(TEMPLATE_CATEGORIES.some((c) => c.id === t.category), t.id);
  if (t.size) assert.equal(t.kind, "image", t.id);
  for (const f of t.fields) assert.ok(t.prompt.includes(`{${f.key}}`), `${t.id} uses {${f.key}}`);
}
assert.equal(templatesIn("all").length, TEMPLATES.length);
assert.ok(templatesIn("business").some((t) => t.id === "teams-background"));
assert.ok(templatesIn("business").some((t) => t.id === "zoom-background"));
assert.equal(templateByName("Teams background")?.size?.w, 1920);
assert.equal(templateByName("nope"), undefined);
assert.equal(sizeLabel({ w: 1080, h: 1350 }), "1080 × 1350");

// Trimming keeps the middle and the right shape.
assert.deepEqual(coverCrop(1024, 1024, { w: 1080, h: 1350 }), { sx: 103, sy: 0, sw: 819, sh: 1024 });
assert.deepEqual(coverCrop(1344, 768, { w: 1584, h: 396 }), { sx: 0, sy: 216, sw: 1344, sh: 336 });
assert.deepEqual(coverCrop(1344, 768, { w: 1344, h: 768 }), { sx: 0, sy: 0, sw: 1344, sh: 768 });

// The business name comes from the brand kit.
const teams = templateByName("Teams background")!;
const start = brandValues(teams, { name: " Glow " });
assert.deepEqual(start, { name: "Glow" });
assert.ok(fillTemplate(teams, start).includes('"Glow"'));
assert.deepEqual(brandValues(teams, {}), {});
console.log("template tests passed");
