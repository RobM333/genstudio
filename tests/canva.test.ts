import assert from "node:assert/strict";
import { fileProblem, mainColors, nearestShape } from "../lib/canva";

// Shapes: Canva's common sizes land on the nearest shape we make
assert.equal(nearestShape(1080, 1080), "1:1");
assert.equal(nearestShape(1080, 1350), "1:1"); // Instagram portrait post
assert.equal(nearestShape(1080, 1920), "9:16"); // story / TikTok
assert.equal(nearestShape(1280, 720), "16:9"); // YouTube thumbnail
assert.equal(nearestShape(1920, 1080), "16:9"); // Teams background
assert.equal(nearestShape(0, 0), "1:1");

// Files
assert.equal(fileProblem("image/png", "Post.png"), null);
assert.equal(fileProblem("image/jpeg", "Post.jpg"), null);
assert.match(fileProblem("video/mp4", "Ad.mp4")!, /videos can't be brought in yet/);
assert.match(fileProblem("application/pdf", "Flyer.pdf")!, /PDF/);
assert.match(fileProblem("application/zip", "Pages.zip")!, /one page/);
assert.match(fileProblem("image/svg+xml", "Logo.svg")!, /SVG/);
assert.match(fileProblem("", "something.mp4")!, /videos/);

// Colours: the main colours, not the white background or black text
const px = (r: number, g: number, b: number, n: number) => Array.from({ length: n }, () => [r, g, b, 255]).flat();
const design = [...px(255, 255, 255, 500), ...px(20, 20, 20, 100), ...px(230, 60, 40, 250), ...px(30, 90, 200, 150)];
const c = mainColors(design);
assert.equal(c[0], "#e63c28");
assert.equal(c[1], "#1e5ac8");
assert.ok(c.length <= 3);
// A black and white design still gives something
assert.ok(mainColors([...px(255, 255, 255, 50), ...px(0, 0, 0, 50)]).length >= 1);
// See-through pixels are ignored
assert.deepEqual(mainColors([0, 0, 0, 0, 0, 0, 0, 0]), []);

console.log("canva tests passed");
