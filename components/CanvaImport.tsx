"use client";

import { useEffect, useRef, useState } from "react";
import type { AppMode } from "@/lib/config";
import { CANVA_STEPS, fileProblem, mainColors } from "@/lib/canva";
import { finishReference, shrink } from "./ReferencesBox";

// "Bring in from Canva": short steps for downloading a design from Canva, then
// a drop area. The picture goes through the same upload and safety check as a
// reference photo, then opens as a finished result with what to do next.

export type Design = { url: string; token: string; name: string; width: number; height: number; colors: string[] };

/** The picture's size and main colours, read in the browser before it's uploaded. */
async function readDesign(file: File): Promise<{ width: number; height: number; colors: string[] }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 120 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const colors = mainColors(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  return { width: bitmap.width, height: bitmap.height, colors };
}

export default function CanvaImport({
  mode,
  onDone,
  onClose,
}: {
  mode: AppMode;
  onDone: (d: Design) => void;
  onClose: () => void;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  async function bringIn(file: File) {
    setError(null);
    const problem = fileProblem(file.type, file.name);
    if (problem) {
      setError(problem);
      return;
    }
    if (!consent) {
      setError("Please tick the box to confirm you made this design or may use everything in it.");
      return;
    }
    try {
      setBusy("Bringing it in…");
      const info = await readDesign(file);
      const blob = await shrink(file, file.type === "image/png");
      const form = new FormData();
      form.append("file", blob, file.name);
      form.append("kind", "style");
      form.append("consent", "yes");
      const res = await fetch("/api/reference", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      if (data.status !== "COMPLETED") setBusy("Checking the design…");
      const done = await finishReference(data, "style");
      onDone({ url: done.url, token: done.token, name: file.name.replace(/\.[a-z]+$/i, "").slice(0, 60), ...info });
    } catch (e) {
      setError((e as Error).message || "Upload failed.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="refs-box canva-box" ref={boxRef}>
      <div className="canva-head">
        <strong>🎨 Bring in your Canva design</strong>
        <button className="link-btn" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <ol className="canva-steps">
        {CANVA_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <label className="refs-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I made this design, or have permission to use everything in it (photos, logos and any people shown). No children.</span>
      </label>
      <div
        className={over ? "canva-drop over" : "canva-drop"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) bringIn(f);
        }}
      >
        <span>{busy ?? "Drop your Canva file here"}</span>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) bringIn(f);
          }}
        />
        <button
          className="refs-add"
          disabled={!!busy || mode === "locked"}
          onClick={() => (consent ? fileInput.current?.click() : setError("Please tick the box first."))}
        >
          Choose file
        </button>
      </div>
      <p className="muted small canva-after">
        Then you can bring it to life as a video, resize it for TikTok, Instagram or YouTube, make an ad with a voiceover from it, or use it as your brand look.
      </p>
      {error && <p className="notice warn small-notice">{error}</p>}
    </div>
  );
}
