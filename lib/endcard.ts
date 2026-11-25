/**
 * End-card words drawn by the app itself, never by the picture model: picture
 * models misspell words, so the headline, tagline and web address are typed
 * onto the finished picture in the browser.
 */

/** A web address as people say it: "https://www.ToastyFly.com/" becomes "toastyfly.com". Empty if it doesn't look like one. */
export function cleanWebsite(raw?: string): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) && s.length <= 60 ? s : "";
}

/** Splits words into lines no wider than maxWidth, using the measure given (canvas measureText in the browser). */
export function wrapWords(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export type CardLine = { text: string; size: number; weight: number; y: number; pill?: boolean };

/**
 * Where each line of the end card goes, in the top part of the picture (the
 * picture is made with that space left empty). The headline shrinks until it
 * fits in at most 3 lines.
 */
export function cardLines(
  w: number,
  h: number,
  words: { headline: string; tagline?: string; website?: string },
  measure: (s: string, size: number, weight: number) => number,
): CardLine[] {
  const maxWidth = w * 0.86;
  const out: CardLine[] = [];
  let size = Math.round(w * 0.11);
  let head = wrapWords(words.headline, maxWidth, (s) => measure(s, size, 800));
  while ((head.length > 3 || head.some((l) => measure(l, size, 800) > maxWidth)) && size > w * 0.05) {
    size = Math.round(size * 0.9);
    head = wrapWords(words.headline, maxWidth, (s) => measure(s, size, 800));
  }
  let y = Math.round(h * 0.07) + size;
  for (const t of head) {
    out.push({ text: t, size, weight: 800, y });
    y += Math.round(size * 1.08);
  }
  if (words.tagline) {
    const ts = Math.round(Math.min(size * 0.5, w * 0.055));
    y += Math.round(ts * 0.35);
    for (const t of wrapWords(words.tagline, maxWidth, (s) => measure(s, ts, 600)).slice(0, 2)) {
      out.push({ text: t, size: ts, weight: 600, y });
      y += Math.round(ts * 1.25);
    }
  }
  const site = cleanWebsite(words.website);
  if (site) {
    const ss = Math.round(w * 0.045);
    y += Math.round(ss * 0.9);
    out.push({ text: site, size: ss, weight: 700, y, pill: true });
  }
  return out;
}

/** Black or white, whichever reads better on the colour given. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

export type Box = { x: number; y: number; w: number; h: number };

/**
 * The part of a picture inside any black bars (pixels RGBA of a small copy).
 * Picture models sometimes letterbox a tall picture; the end card is then
 * cropped to this part and filled edge to edge, for free. Only rows or
 * columns that are black across their whole width count as bars.
 */
export function contentBox(px: Uint8ClampedArray | number[], w: number, h: number): Box {
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  };
  const darkRow = (y: number) => {
    let sum = 0;
    let max = 0;
    for (let x = 0; x < w; x++) {
      const l = lum(x, y);
      sum += l;
      max = Math.max(max, l);
    }
    return sum / w < 14 && max < 40;
  };
  const darkCol = (x: number, y0: number, y1: number) => {
    let sum = 0;
    let max = 0;
    for (let y = y0; y < y1; y++) {
      const l = lum(x, y);
      sum += l;
      max = Math.max(max, l);
    }
    return sum / Math.max(1, y1 - y0) < 14 && max < 40;
  };
  let top = 0;
  while (top < h - 1 && darkRow(top)) top++;
  let bottom = h;
  while (bottom > top + 1 && darkRow(bottom - 1)) bottom--;
  let left = 0;
  while (left < w - 1 && darkCol(left, top, bottom)) left++;
  let right = w;
  while (right > left + 1 && darkCol(right - 1, top, bottom)) right--;
  // Ignore pictures that are almost all dark (a night scene, not bars).
  if ((bottom - top) * (right - left) < w * h * 0.4) return { x: 0, y: 0, w, h };
  const box = { x: left, y: top, w: right - left, h: bottom - top };
  return box;
}

/** The part of the source box to draw so it covers a w by h frame without stretching (cut evenly from the long sides). */
export function coverCrop(box: Box, w: number, h: number): Box {
  const want = w / h;
  if (box.w / box.h > want) {
    const cw = box.h * want;
    return { x: box.x + (box.w - cw) / 2, y: box.y, w: cw, h: box.h };
  }
  const ch = box.w / want;
  return { x: box.x, y: box.y + (box.h - ch) / 2, w: box.w, h: ch };
}
