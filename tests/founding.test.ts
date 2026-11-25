import assert from "node:assert/strict";
import { cleanEmail, cleanMakes, cleanRefCode, cleanText, foundingPriceText, inboxOf, isThrowawayEmail, MAKES, spotsLeft, spotsLine, TOTAL_SPOTS } from "../lib/founding";
import { whatCreditsMake } from "../lib/pricing";
import { foundingPriceLines, FREE_MONTH_MAKES } from "../lib/foundingOffer";
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

// Only the landing page, the sign-up page and what they need skip the app password
for (const p of ["/", "/founding", "/founding/", "/api/founding", "/privacy", "/terms", "/acceptable-use", "/__forms.html"]) {
  assert.equal(isPublicPath(p), true, p);
}
for (const p of ["/studio", "/studio/", "/pricing", "/api/founding/list", "/api/generate", "/foundingx", "/founding/list", "/api/founding/../generate"]) {
  assert.equal(isPublicPath(p), false, p);
}

// The offer's words: estimates only, and what 500 credits really makes at today's rates.
assert.equal(foundingPriceText(19), "about $13");
assert.equal(foundingPriceText(49), "about $34");
const made = whatCreditsMake(500);
assert.ok(made.pictures >= 100 && made.pictures <= 125, String(made.pictures));
assert.ok(made.videosLow >= 10 && made.videosHigh <= 16, `${made.videosLow}-${made.videosHigh}`);
assert.equal(FREE_MONTH_MAKES, made.text);
const lines = foundingPriceLines("2026-12-24").join(" ");
assert.ok(lines.includes("about $13") && lines.includes("estimates") && lines.includes("nothing is charged"), lines);
assert.ok(!/\$\d+\.\d\d/.test(lines), "never an exact price");

// Invite links
assert.equal(cleanRefCode("Ab3dEf7h"), "Ab3dEf7h");
assert.equal(cleanRefCode("short"), null);
assert.equal(cleanRefCode("../../x1"), null);
assert.equal(inboxOf("Sam.Smith+promo@GoogleMail.com"), "samsmith@gmail.com");
assert.equal(inboxOf("sam.smith+x@example.com"), "sam.smith@example.com");
assert.ok(isThrowawayEmail("a@mailinator.com") && isThrowawayEmail("a@x.yopmail.com"));
assert.ok(!isThrowawayEmail("a@gmail.com"));

console.log("founding tests passed");
