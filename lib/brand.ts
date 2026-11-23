// The brand kit: a brand name, up to three colours, a few style words, a
// preferred voice and a small library of the user's own pictures (product,
// logo, people who agreed, style). Saved once in the browser and reused in
// every project, so ads and pictures stay on brand without re-uploading.

export type BrandInfo = { name?: string; colors?: string[]; style?: string };

const NAMED: [string, number, number, number][] = [
  ["black", 0, 0, 0], ["charcoal", 54, 54, 54], ["grey", 128, 128, 128], ["silver", 192, 192, 192], ["white", 255, 255, 255],
  ["cream", 245, 238, 220], ["beige", 222, 205, 170], ["brown", 120, 72, 40], ["tan", 196, 154, 108],
  ["red", 210, 35, 40], ["burgundy", 120, 20, 40], ["coral", 250, 120, 95], ["pink", 245, 160, 190], ["hot pink", 235, 50, 140],
  ["orange", 245, 130, 30], ["peach", 250, 200, 160], ["gold", 212, 175, 55], ["yellow", 250, 215, 40], ["mustard", 200, 160, 40],
  ["lime green", 160, 210, 60], ["green", 40, 150, 70], ["forest green", 30, 85, 50], ["olive", 120, 125, 60], ["mint", 170, 230, 200], ["sage", 160, 180, 145],
  ["teal", 0, 128, 128], ["turquoise", 60, 205, 200], ["sky blue", 120, 190, 235], ["blue", 40, 100, 220], ["royal blue", 50, 70, 190], ["navy", 20, 35, 80],
  ["lavender", 190, 170, 230], ["purple", 120, 60, 170], ["plum", 100, 40, 90],
];

/** The nearest plain colour name for a hex colour, so image models understand it. */
export function colorName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "";
  const n = parseInt(m[1], 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  let best = NAMED[0][0];
  let dist = Infinity;
  for (const [name, R, G, B] of NAMED) {
    const d = (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11;
    if (d < dist) {
      dist = d;
      best = name;
    }
  }
  return best;
}

export function cleanBrand(b: unknown): BrandInfo | undefined {
  if (!b || typeof b !== "object") return undefined;
  const o = b as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const colors = Array.isArray(o.colors) ? o.colors.map(String).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3) : [];
  const style = typeof o.style === "string" ? o.style.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  if (!name && !colors.length && !style) return undefined;
  return { name: name || undefined, colors: colors.length ? colors : undefined, style: style || undefined };
}

/** One line describing the brand, for planners and picture prompts. */
export function brandLine(b?: BrandInfo): string {
  if (!b) return "";
  const parts: string[] = [];
  if (b.name) parts.push(`Brand name: ${b.name}`);
  const names = [...new Set((b.colors ?? []).map(colorName).filter(Boolean))];
  if (names.length) parts.push(`brand colours: ${names.join(", ")}`);
  if (b.style) parts.push(`brand style: ${b.style}`);
  return parts.join("; ");
}
