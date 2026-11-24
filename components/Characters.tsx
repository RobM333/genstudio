"use client";

import { useRef, useState } from "react";
import type { AppMode } from "@/lib/config";
import { checkCharacter, MAX_CHARACTERS, type Character } from "@/lib/characters";
import { estimateCost, formatCost, REFERENCE_IMAGE_MODEL } from "@/lib/models";
import { finishReference, shrink, type RefItem } from "./ReferencesBox";
import { makeLook } from "./filmRunner";

// Saved characters: create a person once (invented, or you from a photo), and
// they keep the same face in every picture, video, ad and film.

export const LOOK_COST = estimateCost(REFERENCE_IMAGE_MODEL);

const blank = () => ({ name: "", look: "", outfit: "" });

export default function Characters({
  characters,
  onChange,
  mode,
  kitPeople = [],
  compact,
  onPick,
  picked = [],
}: {
  characters: Character[];
  onChange: (list: Character[]) => void;
  mode: AppMode;
  kitPeople?: RefItem[]; // people already in the brand kit, whose photo can be used
  compact?: boolean; // inside Film Set: pick characters for this film
  onPick?: (c: Character) => void;
  picked?: string[];
}) {
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [photo, setPhoto] = useState<{ url: string; token: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const price = mode === "demo" ? "Free in demo" : `est. ${formatCost(LOOK_COST)}`;

  async function upload(file: File) {
    setError(null);
    if (!consent) return setError("Please tick the box first.");
    try {
      setBusy("Checking the photo…");
      const blob = await shrink(file, false);
      const fd = new FormData();
      fd.append("file", blob, file.name);
      fd.append("kind", "person");
      fd.append("consent", "yes");
      const res = await fetch("/api/reference", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      setPhoto(await finishReference(data, "person"));
    } catch (e) {
      setError((e as Error).message || "Upload failed.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function lookFor(c: Character, list: Character[]) {
    setBusy(`Making ${c.name}'s look picture…`);
    setError(null);
    try {
      const look = await makeLook(c);
      onChange(list.map((x) => (x.id === c.id ? { ...x, ...look } : x)));
    } catch (e) {
      setError((e as Error).message || "Couldn't make the look picture.");
    } finally {
      setBusy(null);
    }
  }

  function save() {
    if (!form) return;
    const check = checkCharacter(form);
    if (!check.ok) return setError(check.reason);
    const c: Character = { id: crypto.randomUUID(), name: form.name.trim(), look: form.look.trim(), outfit: form.outfit.trim(), photo: photo ?? undefined, createdAt: Date.now() };
    const list = [...characters, c].slice(-MAX_CHARACTERS);
    onChange(list);
    setForm(null);
    setPhoto(null);
    setConsent(false);
    setError(null);
    if (mode !== "locked") lookFor(c, list);
  }

  return (
    <div className={compact ? "chars compact" : "chars"}>
      {characters.length > 0 && (
        <div className="char-list">
          {characters.map((c) => {
            const on = picked.includes(c.id);
            return (
              <div key={c.id} className={on ? "char-card on" : "char-card"}>
                <div className="char-pic">
                  {c.sheetUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.sheetUrl} alt={`${c.name}'s look picture`} />
                  ) : (
                    <span className="char-initial" aria-hidden>
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="char-text">
                  <strong>{c.name}</strong>
                  <span className="muted small">{[c.look, c.outfit && `usually wears ${c.outfit}`].filter(Boolean).join(" · ") || "No description"}</span>
                  {c.photo && <span className="tag">From a photo</span>}
                </div>
                <div className="char-actions">
                  {onPick && (
                    <button className={on ? "pill active" : "pill"} onClick={() => onPick(c)}>
                      {on ? "✓ In this film" : "＋ Add to film"}
                    </button>
                  )}
                  {!compact && (
                    <>
                      <button className="pill" disabled={!!busy || mode === "locked"} onClick={() => lookFor(c, characters)}>
                        {c.sheetUrl ? "↻ New look picture" : "Make look picture"} · {price}
                      </button>
                      <button className="link-btn" aria-label={`Remove ${c.name}`} onClick={() => onChange(characters.filter((x) => x.id !== c.id))}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form ? (
        <div className="char-form">
          <div className="char-form-row">
            <label className="sub-label" htmlFor="char-name">
              First name or nickname
            </label>
            <input id="char-name" className="text-input" maxLength={24} placeholder="e.g. Mia" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <label className="sub-label" htmlFor="char-look">
            How they look <span className="step-opt">face, hair, skin tone, age, build: this never changes</span>
          </label>
          <input
            id="char-look"
            className="text-input"
            maxLength={300}
            placeholder={photo ? "Optional when you use a photo" : "e.g. woman in her late 20s, warm brown skin, curly shoulder-length black hair, freckles, friendly smile"}
            value={form.look}
            onChange={(e) => setForm({ ...form, look: e.target.value })}
          />
          <label className="sub-label" htmlFor="char-outfit">
            What they usually wear <span className="step-opt">each film or post can change it</span>
          </label>
          <input id="char-outfit" className="text-input" maxLength={200} placeholder="e.g. mustard knit jumper, light blue jeans, white sneakers" value={form.outfit} onChange={(e) => setForm({ ...form, outfit: e.target.value })} />

          <div className="sub-label">Use a real face? (optional)</div>
          {photo ? (
            <div className="char-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="Their photo" />
              <button className="link-btn" onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            </div>
          ) : (
            <>
              {kitPeople.length > 0 && (
                <div className="pills">
                  {kitPeople.map((p) => (
                    <button key={p.url} className="pill" onClick={() => setPhoto({ url: p.url, token: p.token })}>
                      🙂 {p.name || "Saved person"}
                    </button>
                  ))}
                </div>
              )}
              <label className="refs-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>This is me, or an adult who agreed to be used as this character. Never a famous person or a child.</span>
              </label>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
              />
              <button className="refs-add" disabled={!!busy || mode === "locked"} onClick={() => (consent ? fileInput.current?.click() : setError("Please tick the box first."))}>
                ＋ Upload a clear face photo
              </button>
              <p className="muted small">Or leave it: we invent a new person from your description.</p>
            </>
          )}
          <div className="char-form-actions">
            <button className="generate small" disabled={!!busy || mode === "locked"} onClick={save}>
              Save and make their look picture · {price}
            </button>
            {(characters.length > 0 || compact) && (
              <button className="link-btn" onClick={() => setForm(null)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        characters.length < MAX_CHARACTERS && (
          <button className="pill char-new" onClick={() => setForm(blank())}>
            ＋ New character
          </button>
        )
      )}
      {busy && (
        <p className="muted small">
          <span className="spinner tiny" /> {busy}
        </p>
      )}
      {error && <p className="notice warn small-notice">{error}</p>}
    </div>
  );
}
