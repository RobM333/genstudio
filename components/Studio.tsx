"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MODELS, type AspectRatio, type MediaKind } from "@/lib/models";
import type { AppMode } from "@/lib/config";

type Item = {
  id: string;
  kind: MediaKind;
  modelId: string;
  modelName: string;
  prompt: string;
  aspectRatio: AspectRatio;
  duration?: number;
  status: "pending" | "done" | "failed";
  requestId?: string;
  url?: string;
  error?: string;
  demo?: boolean;
  createdAt: number;
};

const STORAGE_KEY = "genstudio.gallery.v1";
const MAX_ITEMS = 200;

const EXAMPLES: Record<MediaKind, string[]> = {
  image: [
    "A glass perfume bottle on wet black stone, soft studio light, product photo",
    "Cozy coffee shop at golden hour, film photography, warm tones",
    "Bold flat illustration of a rocket made of sneakers, bright colors",
  ],
  video: [
    "Slow dolly shot of a sneaker rotating on a neon-lit pedestal, rain outside the window",
    "Drone shot over turquoise ocean waves crashing on black sand at sunrise",
    "A barista pouring latte art in slow motion, shallow depth of field",
  ],
};

function loadItems(): Item[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Item[]) : [];
  } catch {
    return [];
  }
}

function saveItems(items: Item[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // storage full or blocked: the gallery still works for this visit
  }
}

export default function Studio({ mode }: { mode: AppMode }) {
  const [kind, setKind] = useState<MediaKind>("image");
  const models = useMemo(() => MODELS.filter((m) => m.kind === kind), [kind]);
  const [modelId, setModelId] = useState(models[0].id);
  const model = MODELS.find((m) => m.id === modelId) ?? models[0];
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | MediaKind>("all");
  const [open, setOpen] = useState<Item | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const polling = useRef(new Set<string>());

  // Load the saved gallery once, in the browser.
  useEffect(() => {
    setItems(loadItems());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) saveItems(items);
  }, [items, loaded]);

  // Keep model, size and length valid when switching between image and video.
  useEffect(() => {
    if (!models.some((m) => m.id === modelId)) setModelId(models[0].id);
  }, [models, modelId]);
  useEffect(() => {
    if (!model.aspectRatios.includes(aspectRatio)) setAspectRatio(model.aspectRatios[0]);
    if (model.durations && !model.durations.includes(duration ?? -1)) setDuration(model.durations[0]);
    if (!model.durations) setDuration(undefined);
  }, [model, aspectRatio, duration]);

  const update = useCallback((id: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const poll = useCallback(
    async (item: Item) => {
      if (!item.requestId || polling.current.has(item.id)) return;
      polling.current.add(item.id);
      const started = Date.now();
      try {
        while (Date.now() - started < 20 * 60 * 1000) {
          await new Promise((r) => setTimeout(r, item.kind === "video" ? 5000 : 2000));
          const res = await fetch(
            `/api/status?modelId=${encodeURIComponent(item.modelId)}&requestId=${encodeURIComponent(item.requestId)}`,
          );
          const data = await res.json().catch(() => ({}));
          if (data.status === "COMPLETED" && data.url) return update(item.id, { status: "done", url: data.url });
          if (data.status === "FAILED" || !res.ok)
            return update(item.id, { status: "failed", error: data.error ?? "Something went wrong." });
        }
        update(item.id, { status: "failed", error: "This took too long. Please try again." });
      } catch {
        update(item.id, { status: "failed", error: "Lost connection while waiting." });
      } finally {
        polling.current.delete(item.id);
      }
    },
    [update],
  );

  // Resume any jobs that were still running when the page was closed.
  useEffect(() => {
    if (!loaded) return;
    items.filter((it) => it.status === "pending" && it.requestId).forEach(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  async function generate() {
    setFormError(null);
    const text = prompt.trim();
    if (!text) {
      setFormError("Describe what you want to create first.");
      return;
    }
    const item: Item = {
      id: crypto.randomUUID(),
      kind: model.kind,
      modelId: model.id,
      modelName: model.name,
      prompt: text,
      aspectRatio,
      duration,
      status: "pending",
      createdAt: Date.now(),
    };
    setItems((prev) => [item, ...prev]);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: model.id, prompt: text, aspectRatio, duration }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return update(item.id, { status: "failed", error: data.error ?? "Something went wrong." });
      if (data.status === "COMPLETED") return update(item.id, { status: "done", url: data.url, demo: data.demo });
      const withRequest = { ...item, requestId: data.requestId as string };
      update(item.id, { requestId: withRequest.requestId });
      poll(withRequest);
    } catch {
      update(item.id, { status: "failed", error: "Couldn't reach the server." });
    }
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setOpen(null);
  }

  const shown = items.filter((it) => filter === "all" || it.kind === filter);
  const pendingCount = items.filter((it) => it.status === "pending").length;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◆</span> GenStudio
        </div>
        <ModeBadge mode={mode} />
      </header>

      {mode === "demo" && (
        <div className="notice">
          <strong>Demo mode.</strong> No AI service is connected yet, so you get free placeholder results. Everything
          else works for real. Add a fal.ai key to switch on real generation.
        </div>
      )}
      {mode === "locked" && (
        <div className="notice warn">
          <strong>Almost live.</strong> A fal.ai key is set, but real generation stays off until you also set an{" "}
          <code>APP_PASSWORD</code>, so strangers can&apos;t spend your credit.
        </div>
      )}

      <main className="layout">
        <section className="panel" aria-label="Create">
          <div className="tabs" role="tablist">
            {(["image", "video"] as MediaKind[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                className={kind === k ? "tab active" : "tab"}
                onClick={() => setKind(k)}
              >
                {k === "image" ? "Image" : "Video"}
              </button>
            ))}
          </div>

          <label className="label" htmlFor="prompt">
            Describe your {kind}
          </label>
          <textarea
            id="prompt"
            className="prompt"
            rows={5}
            maxLength={2000}
            placeholder={EXAMPLES[kind][0]}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
            }}
          />
          <div className="examples">
            {EXAMPLES[kind].map((ex) => (
              <button key={ex} className="chip" onClick={() => setPrompt(ex)}>
                {ex.length > 42 ? ex.slice(0, 40) + "..." : ex}
              </button>
            ))}
          </div>

          <div className="label">Model</div>
          <div className="models">
            {models.map((m) => (
              <button
                key={m.id}
                className={m.id === model.id ? "model active" : "model"}
                onClick={() => setModelId(m.id)}
              >
                <span className="model-name">{m.name}</span>
                <span className="model-tag">{m.tagline}</span>
                <span className="model-cost">{m.approxCost}</span>
              </button>
            ))}
          </div>

          <div className="row">
            <div>
              <div className="label">Shape</div>
              <div className="pills">
                {model.aspectRatios.map((ar) => (
                  <button
                    key={ar}
                    className={ar === aspectRatio ? "pill active" : "pill"}
                    onClick={() => setAspectRatio(ar)}
                  >
                    <span className={`ar ar-${ar.replace(":", "x")}`} aria-hidden /> {ar}
                  </button>
                ))}
              </div>
            </div>
            {model.durations && (
              <div>
                <div className="label">Length</div>
                <div className="pills">
                  {model.durations.map((d) => (
                    <button key={d} className={d === duration ? "pill active" : "pill"} onClick={() => setDuration(d)}>
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {formError && <p className="error">{formError}</p>}
          <button className="generate" onClick={generate} disabled={mode === "locked"}>
            Generate {kind}
            {pendingCount > 0 && <span className="count">{pendingCount} running</span>}
          </button>
          <p className="hint">
            {mode === "demo" ? "Demo results are free." : `Estimated cost: ${model.approxCost}.`} Tip: Ctrl/⌘ + Enter
            to generate.
          </p>
        </section>

        <section className="gallery-wrap" aria-label="Gallery">
          <div className="gallery-head">
            <h2>Your gallery</h2>
            <div className="pills">
              {(["all", "image", "video"] as const).map((f) => (
                <button key={f} className={filter === f ? "pill active" : "pill"} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "image" ? "Images" : "Videos"}
                </button>
              ))}
            </div>
          </div>

          {loaded && shown.length === 0 && (
            <div className="empty">
              <p>Nothing here yet.</p>
              <p className="muted">Write a prompt and press Generate. Your creations are saved in this browser.</p>
            </div>
          )}

          <div className="grid">
            {shown.map((it) => (
              <button
                key={it.id}
                className={`tile ar-box-${it.aspectRatio.replace(":", "x")}`}
                onClick={() => it.status !== "pending" && setOpen(it)}
                title={it.prompt}
              >
                {it.status === "pending" && (
                  <div className="tile-state">
                    <span className="spinner" aria-hidden />
                    <span>Creating {it.kind}...</span>
                  </div>
                )}
                {it.status === "failed" && (
                  <div className="tile-state failed">
                    <span>Failed</span>
                    <span className="muted small">{it.error}</span>
                  </div>
                )}
                {it.status === "done" && it.url && <Media item={it} thumb />}
                <span className="tile-label">
                  {it.kind === "video" ? "▶ " : ""}
                  {it.modelName}
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>

      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="viewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Preview">
            <div className="viewer-media">
              {open.url ? <Media item={open} /> : <div className="tile-state failed">{open.error}</div>}
            </div>
            <div className="viewer-side">
              <p className="viewer-prompt">{open.prompt}</p>
              <dl className="meta">
                <dt>Model</dt>
                <dd>{open.modelName}</dd>
                <dt>Shape</dt>
                <dd>{open.aspectRatio}</dd>
                {open.duration && (
                  <>
                    <dt>Length</dt>
                    <dd>{open.duration}s</dd>
                  </>
                )}
                <dt>Made</dt>
                <dd>{new Date(open.createdAt).toLocaleString()}</dd>
              </dl>
              <div className="viewer-actions">
                {open.url && (
                  <button className="pill active" onClick={() => download(open)}>
                    Download
                  </button>
                )}
                <button
                  className="pill"
                  onClick={() => {
                    setKind(open.kind);
                    setModelId(open.modelId);
                    setPrompt(open.prompt);
                    setOpen(null);
                  }}
                >
                  Reuse prompt
                </button>
                <button className="pill danger" onClick={() => remove(open.id)}>
                  Delete
                </button>
              </div>
              <button className="close" onClick={() => setOpen(null)} aria-label="Close">
                ×
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeBadge({ mode }: { mode: AppMode }) {
  const text = mode === "live" ? "Live" : mode === "locked" ? "Needs password" : "Demo mode";
  return <span className={`badge badge-${mode}`}>{text}</span>;
}

function Media({ item, thumb }: { item: Item; thumb?: boolean }) {
  const isPlaceholder = item.url?.startsWith("data:image");
  if (item.kind === "video" && !isPlaceholder) {
    return (
      <video
        src={item.url}
        autoPlay={!thumb}
        muted={thumb}
        loop
        playsInline
        controls={!thumb}
        onMouseEnter={thumb ? (e) => e.currentTarget.play().catch(() => {}) : undefined}
        onMouseLeave={thumb ? (e) => e.currentTarget.pause() : undefined}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={item.url} alt={item.prompt} />;
}

async function download(item: Item) {
  if (!item.url) return;
  const ext = item.url.startsWith("data:image/svg") ? "svg" : item.kind === "video" ? "mp4" : "png";
  const name = `genstudio-${item.kind}-${item.id.slice(0, 8)}.${ext}`;
  let href = item.url;
  let revoke = false;
  if (!item.url.startsWith("data:")) {
    try {
      const blob = await (await fetch(item.url)).blob();
      href = URL.createObjectURL(blob);
      revoke = true;
    } catch {
      window.open(item.url, "_blank", "noopener");
      return;
    }
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 5000);
}
