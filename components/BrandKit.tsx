"use client";

import type { AppMode } from "@/lib/config";
import { useState } from "react";
import { isOwnVoice, looksLikeKey, needsConsent, voiceKind } from "@/lib/elevenlabs";
import { fetchVoices, saveEleven, type ElevenConnection } from "./elevenConnect";
import { OwnVoiceOptions } from "./VoiceOptions";
import { brandLine, colorName, type BrandInfo } from "@/lib/brand";
import ReferencesBox, { type RefItem } from "./ReferencesBox";
import { WeekPlan } from "./IdeaHelpers";
import type { Idea } from "@/lib/ideas";

// The brand kit page: save the brand once, then switch it on in any project.
// It lives in this browser until accounts arrive.

export type Brand = BrandInfo & { business?: string; voice?: string; pictures: RefItem[] };

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

export default function BrandKit({
  brand,
  onChange,
  mode,
  onUseIdea,
  eleven,
  onEleven,
}: {
  brand: Brand;
  onChange: (b: Brand) => void;
  mode: AppMode;
  onUseIdea: (i: Idea) => void;
  eleven: ElevenConnection | null;
  onEleven: (c: ElevenConnection | null) => void;
}) {
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
        <label className="sub-label" htmlFor="brand-business">
          What you sell <span className="step-opt">used for ideas and the week plan</span>
        </label>
        <input
          id="brand-business"
          className="text-input"
          maxLength={400}
          placeholder="e.g. handmade soy candles in glass jars, sold online"
          value={brand.business ?? ""}
          onChange={(e) => onChange({ ...brand, business: e.target.value })}
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
          <OwnVoiceOptions eleven={eleven} current={brand.voice} />
        </select>
        <ElevenLabsConnect
          eleven={eleven}
          onEleven={(c) => {
            onEleven(c);
            // A voice that is no longer connected (or lost its consent tick) stops being the brand voice.
            if (isOwnVoice(brand.voice) && !(c?.voices.some((v) => `el:${v.id}` === brand.voice && (!needsConsent(v.category) || c.consented.includes(v.id)))))
              onChange({ ...brand, voice: undefined });
          }}
          mode={mode}
        />
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

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">3</span>
          <h2>Plan my week</h2>
          <span className="step-opt">a post for each day, ready to make</span>
        </div>
        <WeekPlan brand={brand} mode={mode} onUse={onUseIdea} />
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

/**
 * Optional: connect the user's own ElevenLabs account to use their voices,
 * including a cloned brand voice. The key stays in this browser.
 */
function ElevenLabsConnect({ eleven, onEleven, mode }: { eleven: ElevenConnection | null; onEleven: (c: ElevenConnection | null) => void; mode: AppMode }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (c: ElevenConnection | null) => {
    saveEleven(c);
    onEleven(c);
  };

  async function connect(k: string) {
    setError("");
    if (!looksLikeKey(k)) {
      setError("That doesn't look like an ElevenLabs key. Copy it again from your ElevenLabs settings.");
      return;
    }
    setBusy(true);
    try {
      const voices = await fetchVoices(k);
      update({ key: k, voices, consented: eleven?.key === k ? eleven.consented.filter((id) => voices.some((v) => v.id === id)) : [] });
      setKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggleConsent = (id: string, on: boolean) => {
    if (!eleven) return;
    update({ ...eleven, consented: on ? [...new Set([...eleven.consented, id])] : eleven.consented.filter((x) => x !== id) });
  };

  const cloned = eleven?.voices.filter((v) => needsConsent(v.category)) ?? [];

  return (
    <details className="eleven" open={Boolean(eleven)}>
      <summary>Use your own ElevenLabs voices <span className="muted small">(optional)</span></summary>
      {!eleven ? (
        <div className="eleven-body">
          <p className="muted small">
            Have an ElevenLabs account? Connect it to use your own voices in ad voiceovers, including a cloned brand voice. Those voiceovers are billed to your
            ElevenLabs account, not to GenStudio. Our own voices stay available as well.
          </p>
          <p className="muted small">
            Make a key at elevenlabs.io under Developers, API keys. Give it access to Text to Speech and to Voices (read). Your key is kept only in this
            browser and is never saved by GenStudio.
          </p>
          <div className="eleven-row">
            <input
              className="text-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your ElevenLabs API key"
              aria-label="ElevenLabs API key"
              value={key}
              onChange={(e) => setKey(e.target.value.trim())}
            />
            <button className="pill" disabled={busy || !key || mode === "locked"} onClick={() => connect(key)}>
              {busy ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      ) : (
        <div className="eleven-body">
          <p className="small">
            ✓ Connected. {eleven.voices.length} voice{eleven.voices.length === 1 ? "" : "s"} found. Pick one above, or in any ad&apos;s plan.
          </p>
          {cloned.length > 0 && (
            <>
              <p className="muted small">Voices made from a real person&apos;s recording can be used once you confirm you may use them:</p>
              {cloned.map((v) => (
                <label key={v.id} className="refs-consent">
                  <input type="checkbox" checked={eleven.consented.includes(v.id)} onChange={(e) => toggleConsent(v.id, e.target.checked)} />
                  <span>
                    <strong>{v.name}</strong> <span className="muted">({voiceKind(v.category)})</span>: this is my own voice, or the person whose voice it is
                    agreed to it being used in my ads.
                  </span>
                </label>
              ))}
            </>
          )}
          <div className="eleven-row">
            <button className="pill" disabled={busy} onClick={() => connect(eleven.key)}>
              {busy ? "Checking..." : "Refresh my voices"}
            </button>
            <button className="link-btn" onClick={() => update(null)}>
              Disconnect
            </button>
          </div>
          <p className="muted small">Your key is kept only in this browser. Disconnect to remove it, for example on a shared computer.</p>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </details>
  );
}
