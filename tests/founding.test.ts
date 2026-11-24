import assert from "node:assert/strict";
import { cleanEmail, cleanMakes, cleanText, MAKES, spotsLeft, spotsLine, TOTAL_SPOTS } from "../lib/founding";
import { isPublicPath } from "../lib/publicPaths";

// Emails
assert.equal(cleanEmail("  Sam@Example.COM "), "sam@example.com");
assert.equal(cleanEmail("sam@example"), null);
assert.equal(cleanEmail("not an email"), null);
assert.equal(cleanEmail(""), null);
assert.equal(cleanEmail(42), null);
assert.equal(cleanEmail("a@b.co"), "a@b.co");
assert.equal(cleanEmail(`${"x".repeat(250)}@b.co`), null);

// Optional fields
assert.equal(cleanText("  Sam <script> "), "Sam script");
assert.equal(cleanText("a".repeat(200), 60).length, 60);
assert.equal(cleanText(undefined), "");
assert.equal(cleanMakes(MAKES[0]), MAKES[0]);
assert.equal(cleanMakes("anything else"), "");

// Spots
assert.equal(TOTAL_SPOTS, 100);
assert.equal(spotsLeft(0), 100);
assert.equal(spotsLeft(27), 73);
assert.equal(spotsLeft(140), 0);
assert.equal(spotsLeft(-3), 100);
assert.equal(spotsLine(73), "73 of 100 founding spots left");
assert.equal(spotsLine(1), "1 of 100 founding spots left");
assert.equal(spotsLine(0), "All 100 founding spots are taken");

// Only the sign-up page and what it needs skip the app password
for (const p of ["/founding", "/founding/", "/api/founding", "/privacy", "/terms", "/acceptable-use", "/__forms.html"]) {
  assert.equal(isPublicPath(p), true, p);
}
for (const p of ["/", "/pricing", "/api/founding/list", "/api/generate", "/foundingx", "/founding/list", "/api/founding/../generate"]) {
  assert.equal(isPublicPath(p), false, p);
}

console.log("founding tests passed");
