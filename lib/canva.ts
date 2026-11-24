// "Bring in from Canva": people download a design from Canva as a picture and
// drop it into GenStudio, where it becomes a finished result they can bring to
// life, resize for each app, turn into an ad with a voiceover, or use as their
// brand look. There is no Canva sign-in yet: the file comes from their computer.

import type { AspectRatio } from "./models";

/** What the video step is asked to do with a brought-in design. */
export const DESIGN_MOTION_PROMPT =
  "Bring this design to life with gentle, natural motion. Keep every word, logo and the layout exactly as they are, sharp and readable.";

/** The short on-screen steps for getting a picture out of Canva. */
export const CANVA_STEPS = [
  "In Canva, open your design and press Share, then Download.",
  "Pick PNG (or JPG), choose the page you want, and press Download.",
  "Drop the file here, or press Choose file.",
];

/** The shape (of the three we make) that is closest to a picture's own shape. */
export function nearestShape(width: number, height: number): AspectRatio {
  if (!(width > 0 && height > 0)) return "1:1";
  const r = Math.log(width / height);
  const options: [AspectRatio, number][] = [
    ["1:1", 0],
    ["16:9", Math.log(16 / 9)],
    ["9:16", Math.log(9 / 16)],
  ];
  let best = options[0];
  for (const o of options) if (Math.abs(r - o[1]) < Math.abs(r - best[1])) best = o;
  return best[0];
}

/** A plain reason when the file isn't a picture we can use, or null when it's fine. */
export function fileProblem(type: string, name: string): string | null {
  const t = type.toLowerCase();
  const n = name.toLowerCase();
  if (t.startsWith("video/") || /\.(mp4|mov|webm|gif)$/.test(n))
    return "Canva videos can't be brought in yet. In Canva, download the page you want as a PNG or JPG picture instead, and we can bring it to life here.";
  if (t === "application/pdf" || n.endsWith(".pdf")) return "That's a PDF. In Canva, pick PNG or JPG when you download, then drop that file here.";
  if (t === "application/zip" || n.endsWith(".zip"))
    return "That's a zip of several pages. Open it on your computer and drop in just one page, or download a single page from Canva.";
  if (t === "image/svg+xml" || n.endsWith(".svg")) return "SVG files can't be used. In Canva, pick PNG or JPG when you download.";
  if (!/^image\/(png|jpeg|webp)$/.test(t)) return "Please use a PNG, JPG or WebP picture. In Canva, pick PNG or JPG when you download.";
  return null;
}

const hex = (n: number) => n.toString(16).padStart(2, "0");

/**
 * Up to three main colours of a design, for the brand kit. Very light, very
 * dark and grey pixels are skipped (backgrounds and text), unless that's all
 * there is. `rgba` is the raw pixel data from a canvas.
 */
export function mainColors(rgba: Uint8ClampedArray | number[], max = 3): string[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const plain = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue; // see-through
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    const colourful = hi - lo > 40 && hi > 40 && lo < 235;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const into = colourful ? bins : plain;
    const bin = into.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    into.set(key, bin);
  }
  const ranked = (m: typeof bins) => [...m.values()].sort((a, b) => b.n - a.n);
  const chosen: { r: number; g: number; b: number }[] = [];
  const total = [...bins.values()].reduce((s, x) => s + x.n, 0) + [...plain.values()].reduce((s, x) => s + x.n, 0);
  for (const bin of [...ranked(bins), ...ranked(plain)]) {
    if (chosen.length >= max) break;
    if (bin.n < total * 0.01) continue; // tiny specks
    const c = { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
    // Skip colours that look almost the same as one already picked.
    if (chosen.some((x) => Math.abs(x.r - c.r) + Math.abs(x.g - c.g) + Math.abs(x.b - c.b) < 60)) continue;
    chosen.push(c);
  }
  return chosen.map((c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`);
}
