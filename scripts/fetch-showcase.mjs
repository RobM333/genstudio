// Downloads the showcase pictures and clip (made with ToastyFly itself) into
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
  // Business and social size templates (made-up brand "Bloom Studio").
  "teams-background.jpg": "0ab3afc8/mcbnM0IETH_e__D570MtL_WydgMS45.png",
  "youtube-intro.jpg": "0ab3afc8/cfTcwiP8fuYq2ZvUpKhVU_do3zdYkY.png",
  "brand-announcement.jpg": "0ab3afc8/QB2tt1GSdrKTYaW4W9P93_3toQyTpz.png",
  "youtube-banner.jpg": "0ab3afc8/-z26qi5pAIjW-N_s_GtJb_m1pHK2ky.png",
  "linkedin-banner.jpg": "0ab3afc8/HA1ESuJxa2f34tXkWfILx_LfbZjGLl.png",
  "instagram-portrait.jpg": "0ab3afc8/M3ha_Eeas4dp4jedkb3Bw_1Jm6SAg2.png",
  "facebook-cover.jpg": "0ab3afc8/fuK2E7GTzyKgi3uWXCKmd_dWBZH6PK.png",
  "email-header.jpg": "0ab3afc9/8VDW_XTfG7xlOabw2hiNW_5iySnyco.png",
  "instagram-post.jpg": "0ab3afc8/BN8wDEYLGQVFu1Dhq-j9a_uGrvLBIn.png",
  "zoom-background.jpg": "0ab3afc9/zzDI42CY0X42iADuN-v7h_isAmj2Hs.png",
  "profile-picture.jpg": "0ab3afc9/EUS7OBbh4FlxR9fEYWGUK_GQwECs7Q.png",
  "vertical-video.jpg": "0ab3afc9/yh28FGueKm8d923VGvs9B_NsVkgamO.png",
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
