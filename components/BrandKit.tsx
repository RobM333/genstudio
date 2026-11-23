"use client";

import type { AppMode } from "@/lib/config";
import { AD_VOICES } from "@/lib/adplan";
import { brandLine, colorName, type BrandInfo } from "@/lib/brand";
import ReferencesBox, { type RefItem } from "./ReferencesBox";

// The brand kit page: save the brand once, then switch it on in any project.
// It lives in this browser until accounts arrive.

export type Brand = BrandInfo & { voice?: string; pictures: RefItem[] };

const STORE = "genstudio.brand.v1";
export const KIT_PICTURES = 12;

export function loadBrand(): Brand {
  try {
    const raw = localStorage.getItem(STORE);
    const b = raw ? (JSON.parse(raw) as Brand) : null;
    if (b && typeof b === "object")
      return { ...b, pictures: Array.isArray(b.pictures) ? b.pictures.filter((r) => r && r.url && r.kind && r.token).slice(0, KIT_PICTURES) : [] };
  } catch {
    // nothing saved, or storage blocked
  }
  return { pictures: [] };
}

export function saveBrand(b: Brand) {
  try {
    localStorage.setItem(STORE, JSON.stringify(b));
  } catch {
    // storage full or blocked: the kit just won't be remembered
  }
}

/** True when the kit has something to use. */
export function hasBrand(b: Brand): boolean {
  return Boolean(b.name || b.style || b.colors?.length || b.voice || b.pictures.length);
}

/** The words part of the kit, sent to planners and added to prompts. */
export function brandInfo(b: Brand): BrandInfo | undefined {
  if (!b.name && !b.style && !b.colors?.length) return undefined;
  return { name: b.name || undefined, colors: b.colors?.length ? b.colors : undefined, style: b.style || undefined };
}

export default function BrandKit({ brand, onChange, mode }: { brand: Brand; onChange: (b: Brand) => void; mode: AppMode }) {
  const colors = brand.colors ?? [];
  const setColor = (i: number, c: string) => onChange({ ...brand, colors: colors.map((x, j) => (j === i ? c : x)) });
  const line = brandLine(brandInfo(brand));

  return (
    <div className="guided brand-kit" aria-label="Brand kit">
      <div className="guided-head">
        <h1>
          Your <em>brand kit</em>
        </h1>
        <p className="muted">
          Save your brand once. Switch on “Use my brand kit” when you create, and every ad and picture uses your name, colours, style, voice and pictures, so
          everything looks like it comes from one brand.
        </p>
      </div>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">1</span>
          <h2>Name and look</h2>
        </div>
        <label className="sub-label" htmlFor="brand-name">
          Brand name
        </label>
        <input
          id="brand-name"
          className="text-input"
          maxLength={60}
          placeholder="e.g. Glow"
          value={brand.name ?? ""}
          onChange={(e) => onChange({ ...brand, name: e.target.value })}
        />
        <div className="sub-label">Brand colours (up to 3)</div>
        <div className="brand-colors">
          {colors.map((c, i) => (
            <span key={i} className="brand-color">
              <input type="color" value={c} aria-label={`Colour ${i + 1}`} onChange={(e) => setColor(i, e.target.value)} />
              <span className="small">{colorName(c)}</span>
              <button className="link-btn" aria-label="Remove this colour" onClick={() => onChange({ ...brand, colors: colors.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </span>
          ))}
          {colors.length < 3 && (
            <button className="pill" onClick={() => onChange({ ...brand, colors: [...colors, colors.length ? "#1f6feb" : "#f5a623"] })}>
              ＋ Add a colour
            </button>
          )}
        </div>
        <label className="sub-label" htmlFor="brand-style">
          Style in a few words
        </label>
        <input
          id="brand-style"
          className="text-input"
          maxLength={160}
          placeholder="e.g. clean, bright and minimal, lots of natural light"
          value={brand.style ?? ""}
          onChange={(e) => onChange({ ...brand, style: e.target.value })}
        />
        <label className="sub-label" htmlFor="brand-voice">
          Voiceover voice for ads
        </label>
        <select id="brand-voice" className="text-input" value={brand.voice ?? ""} onChange={(e) => onChange({ ...brand, voice: e.target.value || undefined })}>
          <option value="">Let the planner pick</option>
          {AD_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">2</span>
          <h2>Pictures and people</h2>
          <span className="step-opt">your product, logo and people you use again</span>
        </div>
        <ReferencesBox refs={brand.pictures} onChange={(pictures) => onChange({ ...brand, pictures })} mode={mode} max={KIT_PICTURES} library />
        <p className="muted small g-hint">
          A saved person keeps the same face in every project: that is how you reuse a presenter or a character. Only add people who agreed, and adults only.
        </p>
      </section>

      {line && (
        <p className="muted small g-hint brand-preview">
          What we add when the kit is on: <em>{line}</em>
        </p>
      )}
      <p className="muted small g-hint">Saved automatically in this browser.</p>
    </div>
  );
}
