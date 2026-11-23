"use client";

import { useRef, useState } from "react";
import type { AppMode } from "@/lib/config";

// Lets people add their own pictures (product, logo, a person who agreed) so
// ads show the real thing instead of a made-up look-alike. Each upload is
// checked on the server before it can be used.

export type RefKindClient = "product" | "logo" | "person" | "style";
export type RefItem = { url: string; kind: RefKindClient; token: string; name?: string };

const STORE = "genstudio.refs.v1";
const MAX = 4;
const MAX_SIDE = 2048;
const MAX_BYTES = 3.5 * 1024 * 1024;

const KINDS: { kind: RefKindClient; label: string; hint: string }[] = [
  { kind: "product", label: "📦 Product", hint: "Your real product, kept exactly as it looks." },
  { kind: "logo", label: "🏷️ Logo", hint: "Your logo, reproduced faithfully." },
  { kind: "person", label: "🙂 Person", hint: "One adult who agreed to appear. Clear face photo." },
  { kind: "style", label: "🎨 Style", hint: "A picture whose colours and mood you want to match." },
];

export function loadRefs(): RefItem[] {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as RefItem[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && r.url && r.kind && r.token).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function saveRefs(refs: RefItem[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(refs));
  } catch {
    // storage full or blocked: references just won't be remembered
  }
}

/** Shrinks very large photos in the browser so uploads stay quick and under the size limit. */
async function shrink(file: File, keepPng: boolean): Promise<Blob> {
  if (file.size <= MAX_BYTES && file.type !== "image/heic") {
    const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
    if (dims && Math.max(dims.w, dims.h) <= MAX_SIDE) return file;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("resize failed"))), keepPng ? "image/png" : "image/jpeg", 0.9),
  );
}

export default function ReferencesBox({
  refs,
  onChange,
  mode,
}: {
  refs: RefItem[];
  onChange: (refs: RefItem[]) => void;
  mode: AppMode;
}) {
  const [open, setOpen] = useState(refs.length > 0);
  const [kind, setKind] = useState<RefKindClient>("product");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const full = refs.length >= MAX;

  async function upload(file: File) {
    setError(null);
    if (!consent) {
      setError("Please tick the box to confirm you own this picture or have permission.");
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("Please use a PNG, JPG or WebP picture.");
      return;
    }
    try {
      setBusy("Uploading…");
      const blob = await shrink(file, kind === "logo" && file.type === "image/png");
      const form = new FormData();
      form.append("file", blob, file.name);
      form.append("kind", kind);
      form.append("consent", "yes");
      const res = await fetch("/api/reference", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      let done = data;
      if (data.status !== "COMPLETED") {
        setBusy("Checking the picture…");
        const q = new URLSearchParams({ requestId: data.requestId, url: data.url, kind, checkToken: data.checkToken });
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const r = await fetch(`/api/reference?${q}`);
          done = await r.json().catch(() => ({}));
          if (!r.ok || done.status === "REJECTED" || done.status === "FAILED") throw new Error(done.error ?? "Check failed.");
          if (done.status === "COMPLETED") break;
        }
        if (done.status !== "COMPLETED") throw new Error("The check took too long. Please try again.");
      }
      onChange([...refs, { url: done.url, token: done.token, kind, name: file.name.slice(0, 60) }].slice(0, MAX));
    } catch (e) {
      setError((e as Error).message || "Upload failed.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (!open) {
    return (
      <button className="refs-open" onClick={() => setOpen(true)}>
        📎 Use your own product, logo or person
        <span className="muted small"> so the ad shows the real thing</span>
      </button>
    );
  }

  return (
    <div className="refs-box">
      <div className="refs-head">
        <strong>📎 Your references</strong>
        <span className="muted small">
          {refs.length > 0
            ? " Used in your next picture. Videos start from that picture."
            : " Add up to 4 pictures. They're put into your ad exactly as they look."}
        </span>
      </div>

      {refs.length > 0 && (
        <div className="refs-list">
          {refs.map((r, i) => (
            <figure key={r.url} className="ref-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={`${r.kind} reference`} />
              <figcaption>{KINDS.find((k) => k.kind === r.kind)?.label ?? r.kind}</figcaption>
              <button
                className="ref-remove"
                aria-label="Remove this reference"
                onClick={() => onChange(refs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </figure>
          ))}
        </div>
      )}

      {!full && (
        <>
          <div className="pills refs-kinds">
            {KINDS.map((k) => (
              <button key={k.kind} className={k.kind === kind ? "pill active" : "pill"} onClick={() => setKind(k.kind)}>
                {k.label}
              </button>
            ))}
          </div>
          <p className="muted small refs-hint">{KINDS.find((k) => k.kind === kind)?.hint}</p>
          <label className="refs-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I own this picture, or have permission from the person shown. {kind === "person" && "They are an adult. "}
              No children.
            </span>
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
            {busy ?? "＋ Add picture"}
          </button>
        </>
      )}
      {error && <p className="notice warn small-notice">{error}</p>}
    </div>
  );
}
