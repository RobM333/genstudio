import assert from "node:assert/strict";
import { aboutBusiness, adaptInstructions, adaptWithRules, ideasWithRules, parseAdapt, parseIdeas, seasonFor, weekDays, weekInstructions, weekWithRules } from "../lib/ideas";

// Five ideas: bad ones dropped, shapes and lengths kept valid.
const five = parseIdeas(
  'Sure! {"ideas":[{"title":"Hero","why":"Clean","kind":"image","shape":"1:1","seconds":7,"prompt":"A premium studio photo of a sourdough loaf on a linen cloth, soft light from the left."},' +
    '{"title":"Steam","kind":"video","shape":"4:5","seconds":8,"prompt":"Vertical clip of steam rising from a fresh loaf as it is broken open, slow push-in, warm light."},' +
    '{"title":"Too short","prompt":"bread"},' +
    '{"title":"Market","kind":"video","seconds":3,"prompt":"Handheld clip walking past a busy market stall full of pastries, morning light, gentle camera move."}]}',
);
assert.ok(five);
assert.equal(five.length, 3);
assert.equal(five[0].seconds, 0);
assert.equal(five[1].shape, "9:16");
assert.equal(five[1].seconds, 10);
assert.equal(five[2].seconds, 5);
assert.equal(parseIdeas("nothing"), null);
assert.equal(parseIdeas('{"ideas":[]}'), null);

// The week: one post per day, in order, even if the AI mixes up the days.
const days = weekDays(new Date(2026, 10, 24));
assert.deepEqual(days, ["Wed 25 Nov", "Thu 26 Nov", "Fri 27 Nov", "Sat 28 Nov", "Sun 29 Nov", "Mon 30 Nov", "Tue 1 Dec"]);
const post = (day: string) => ({ day, title: day, kind: "image", shape: "1:1", prompt: `A bright product photo for ${day}, soft daylight from a window, clean background.` });
const week = parseIdeas(JSON.stringify({ ideas: [post("Thu 26 Nov"), post("Wed 25 Nov"), post("nope"), post("Sat 28 Nov"), post("Sun 29 Nov"), post("Mon 30 Nov"), post("Tue 1 Dec")] }), days);
assert.ok(week);
assert.deepEqual(week.map((i) => i.day), days);
assert.equal(week[0].title, "Wed 25 Nov");
assert.equal(week[2].title, "nope");
assert.equal(parseIdeas(JSON.stringify({ ideas: [post("Wed 25 Nov")] }), days), null);

// Seasons follow the hemisphere.
assert.match(seasonFor(new Date(2026, 10, 24), "Australia/Sydney"), /^spring in the southern/);
assert.match(seasonFor(new Date(2026, 10, 24), "Europe/London"), /^autumn in the northern/);
assert.match(seasonFor(new Date(2026, 0, 5), "America/New_York"), /^winter/);
assert.match(weekInstructions(days, "spring", { name: "Crumb" }), /Brand name: Crumb/);

// Make one like this: template blanks or a rewritten prompt.
assert.deepEqual(parseAdapt('{"fields":{"product":"a sourdough loaf","surface":"a floured wooden board","extra":"x"}}', [{ key: "product" }, { key: "surface" }]), {
  fields: { product: "a sourdough loaf", surface: "a floured wooden board" },
});
assert.equal(parseAdapt('{"prompt":"short"}'), null);
assert.ok(parseAdapt('{"prompt":"A frosted glass jar of honey on wet black stone, soft studio light, product photo."}')?.prompt);
assert.match(adaptInstructions("image", [{ key: "product", label: "Product" }]), /"product" \(Product\)/);
assert.deepEqual(adaptWithRules("x", "honey", [{ key: "product", placeholder: "perfume" }, { key: "surface", placeholder: "stone" }]).fields, { product: "honey", surface: "stone" });

// Rules when the AI can't be reached.
const r = ideasWithRules("a bakery", "more weekend customers", { colors: ["#1f3a7a"] });
assert.equal(r.length, 5);
assert.ok(r.some((i) => i.kind === "video") && r.some((i) => i.kind === "image"));
assert.match(r[0].prompt, /navy/);
const w = weekWithRules(days, "", { name: "Crumb" });
assert.equal(w.length, 7);
assert.match(w[0].prompt, /Crumb/);
console.log("ideas tests passed");

// A bare brand name must not make the AI invent a product.
assert.match(aboutBusiness("ToastyFly", "ToastyFly"), /Do not invent a product/);
assert.match(aboutBusiness("", "ToastyFly"), /The brand: ToastyFly/);
assert.equal(aboutBusiness("handmade candles", "Glow"), "The business:\nhandmade candles");
