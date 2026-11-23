// Downloads the showcase pictures and clip (made with GenStudio itself) into
// public/showcase/ before each build, shrinking pictures so cards load fast.
// Never fails the build: if a file can't be fetched, the app shows drawn art.
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const BASE = "https://v3b.fal.media/files/b/";
const FILES = {
  "product-hero.jpg": "0ab390ef/XQU6DFpqWekshjLF0eUpp_b7665c990c39411da2d1055503742c41.jpg",
  "lifestyle.jpg": "0ab390ef/qGUoqIV4sM-gqLE3uOSEm_13738afbb5da46c78c00fb4356178e44.jpg",
  "story-ad.jpg": "0ab390f0/Mpj9yJth6OIfg_w4_a_qU_96eae5e05b8b41e4a3fd88a10e28da23.jpg",
  "thumbnail.jpg": "0ab390ef/B6mzk7KJuzPSmMf9AiyJo_9d2dd491ba6f4cf4bb00d1d2bc245ff7.jpg",
  "sale-banner.jpg": "0ab390ef/uZFC1p02RkVsMB4aHeJg7_6785a1eab0ba4aeb87d5905cb33c3d78.jpg",
  "ugc.jpg": "0ab390f0/9zG9KdzfSoNnJzTmUNMcp_a8ceca37fa504e3db8a0d3ae34d7123b.jpg",
  "rocket.jpg": "0ab390ef/WjWBrylNaOpGyujhVnN6Q_736a0a30070b41f1bba60bd6752528d8.jpg",
  "watch.jpg": "0ab390f0/BGG5mOu-kosrK8wgXNhd4_54ca1ae140274727b9e532e8a360da91.jpg",
  "reveal.mp4": "0ab390f5/LntyFhFHJLokAW7CpMvSR_NijmZr9r.mp4",
};

const dir = path.join(process.cwd(), "public", "showcase");
await mkdir(dir, { recursive: true });

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  // sharp not installed: keep full-size pictures
}

await Promise.all(
  Object.entries(FILES).map(async ([name, src]) => {
    const out = path.join(dir, name);
    try {
      await access(out);
      return; // already there
    } catch {}
    try {
      const res = await fetch(BASE + src, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let buf = Buffer.from(await res.arrayBuffer());
      if (sharp && name.endsWith(".jpg")) {
        buf = await sharp(buf).resize({ width: 1000, height: 1000, fit: "inside" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      }
      await writeFile(out, buf);
      console.log(`showcase: ${name} (${Math.round(buf.length / 1024)} KB)`);
    } catch (err) {
      console.warn(`showcase: skipped ${name} (${err.message})`);
    }
  }),
);
