// Demo mode: makes a placeholder picture or animation locally, so the app
// works end to end before a fal.ai key exists. Costs nothing.

import type { AspectRatio, MediaKind } from "./models";

const SIZES: Record<AspectRatio, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) {
      lines.push(line.trim());
      line = w;
      if (lines.length === maxLines) break;
    } else line += " " + w;
  }
  if (lines.length < maxLines && line.trim()) lines.push(line.trim());
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, "...");
  }
  return lines;
}

export function makeDemoMedia(opts: {
  prompt: string;
  kind: MediaKind;
  aspectRatio: AspectRatio;
  modelName: string;
}): string {
  const [w, h] = SIZES[opts.aspectRatio];
  const seed = hash(opts.prompt + opts.modelName);
  const hue1 = seed % 360;
  const hue2 = (hue1 + 60 + (seed % 120)) % 360;
  const hue3 = (hue2 + 90) % 360;
  const fontSize = Math.round(Math.min(w, h) / 18);
  const lines = wrap(opts.prompt, Math.floor((Math.min(w, h) * 0.9) / (fontSize * 0.55)), 4);
  const animate = opts.kind === "video";
  const badge = `DEMO ${animate ? "VIDEO" : "IMAGE"} · ${opts.modelName}`;
  const badgeW = badge.length * fontSize * 0.42 + fontSize;

  const blob = (cx: number, cy: number, r: number, hue: number, dx: number, dy: number, dur: number) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${hue} 90% 60%)" opacity="0.55" filter="url(#blur)">
      ${animate ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${dx} ${dy}; 0 0" dur="${dur}s" repeatCount="indefinite"/>` : ""}
    </circle>`;

  const text = lines
    .map(
      (l, i) =>
        `<text x="50%" y="${h / 2 + (i - (lines.length - 1) / 2) * fontSize * 1.3}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-weight="600" font-size="${fontSize}" fill="white">${escapeXml(l)}</text>`,
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue1} 70% 22%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 70% 12%)"/>
    </linearGradient>
    <filter id="blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${Math.min(w, h) / 12}"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  ${blob(w * 0.25, h * 0.3, Math.min(w, h) * 0.3, hue2, w * 0.3, h * 0.2, 6)}
  ${blob(w * 0.75, h * 0.7, Math.min(w, h) * 0.35, hue3, -w * 0.3, -h * 0.25, 8)}
  ${blob(w * 0.6, h * 0.25, Math.min(w, h) * 0.2, hue1, -w * 0.1, h * 0.4, 5)}
  ${text}
  <rect x="${(w - badgeW) / 2}" y="${fontSize * 0.8}" rx="${fontSize * 0.4}" width="${badgeW}" height="${fontSize * 1.6}" fill="black" opacity="0.45"/>
  <text x="50%" y="${fontSize * 1.65}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${fontSize * 0.7}" fill="white">${escapeXml(badge)}</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
