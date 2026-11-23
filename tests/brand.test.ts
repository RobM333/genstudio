import assert from "node:assert/strict";
import { brandLine, cleanBrand, colorName } from "../lib/brand";
import { productBrief, readProductPage } from "../lib/productpage";
import { adCost, adPlanWithRules, checkCost, maxRedos, redoCap } from "../lib/adplan";
import { checkPublicUrl } from "../lib/safefetch";
import { parseAnalysis } from "../lib/analyze";

assert.equal(colorName("#1f3a7a"), "navy");
assert.equal(colorName("#fafafa"), "white");
assert.equal(colorName("nope"), "");
assert.equal(cleanBrand({ name: "  ", colors: ["red"], style: "" }), undefined);
assert.deepEqual(cleanBrand({ name: "Glow", colors: ["#ff0000", "bad", "#00aa44", "#123456", "#654321"] }), { name: "Glow", colors: ["#ff0000", "#00aa44", "#123456"], style: undefined });
assert.equal(brandLine({ name: "Glow", colors: ["#d22328", "#d32429"], style: "clean" }), "Brand name: Glow; brand colours: red; brand style: clean");
console.log("brand tests passed");

const html = `<html><head><title>Glow Bottle | Shop</title>
<meta property="og:title" content="Glow Bottle &amp; Cap">
<meta property="og:image" content="/img/glow.jpg">
<meta name="description" content="Keeps drinks cold for 24 hours.">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Glow Bottle","description":"A refillable glass bottle.","image":["https://shop.example/a.jpg"],"brand":{"name":"Glow"},"offers":{"price":"29.00","priceCurrency":"USD"}}]}</script>
</head></html>`;
const p = readProductPage(html, "https://shop.example/products/glow");
assert.equal(p.name, "Glow Bottle");
assert.equal(p.price, "$29.00");
assert.equal(p.brand, "Glow");
assert.deepEqual(p.images, ["https://shop.example/a.jpg", "https://shop.example/img/glow.jpg"]);
assert.equal(productBrief(p), "Glow Bottle. A refillable glass bottle. Price: $29.00.");
const bare = readProductPage(`<title>Plain page</title><meta name="description" content="Hello">`, "https://x.example/");
assert.equal(bare.name, "Plain page");
assert.equal(bare.description, "Hello");
console.log("product page tests passed");

assert.equal(maxRedos(2), 1);
assert.equal(maxRedos(5), 2);
assert.equal(maxRedos(11), 4);
const plan = adPlanWithRules({ product: "Glow bottle", audience: "", seconds: 15, tone: "Friendly" });
assert.ok(Math.abs(adCost(plan, false, true) - adCost(plan, false) - checkCost(2)) < 1e-9);
assert.ok(redoCap(2) < 0.5);
const a = parseAnalysis('{"problems":["The hand has six fingers."],"serious":true,"fix":"Fix the hand","prompt":"x"}');
assert.equal(a?.serious, true);
assert.equal(parseAnalysis('{"problems":[],"serious":true,"fix":"","prompt":"x"}')?.serious, false);
console.log("quality check tests passed");

(async () => {
  for (const bad of ["http://example.com", "https://127.0.0.1/", "https://10.0.0.5/x", "https://[::1]/", "https://169.254.169.254/latest", "https://localhost/", "https://user:pw@example.com/", "file:///etc/passwd"]) {
    await assert.rejects(checkPublicUrl(bad), bad);
  }
  console.log("safe fetch tests passed");
})();
