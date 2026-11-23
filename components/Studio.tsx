"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADD_SOUND_MODEL, estimateCost, formatCost, getModel, MODELS, type AspectRatio, type MediaKind } from "@/lib/models";
import { autoAspectRatios, pickModel, type Quality } from "@/lib/router";
import { fillTemplate, TEMPLATES, type Template } from "@/lib/templates";
import type { AppMode } from "@/lib/config";
import { checkPrompt } from "@/lib/safety";
import AgreeModal, { hasAcceptedTerms } from "./AgreeModal";
import Link from "next/link";

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
  quality?: Quality; // set when Auto picked the model
  autoReason?: string;
  parentId?: string; // the draft this final was made from
  templateName?: string;
  wantSound?: boolean; // video: the user asked for sound
  hasAudio?: boolean; // video: the result has sound
  stage?: "video" | "sound"; // which step is running
  jobModelId?: string; // model of the step being polled
  soundError?: string;
};

type JobSpec = {
  kind: MediaKind;
  modelId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  duration?: number;
  quality?: Quality;
  autoReason?: string;
  parentId?: string;
  templateName?: string;
  sound?: boolean;
};

const AUTO = "auto";
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
  const [choice, setChoice] = useState<string>(AUTO); // "auto" or a model id
  const [quality, setQuality] = useState<Quality>("draft");
  const [sound, setSound] = useState(true);
  const [askTerms, setAskTerms] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [template, setTemplate] = useState<Template | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | MediaKind>("all");
  const [open, setOpen] = useState<Item | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const polling = useRef(new Set<string>());

  const isAuto = choice === AUTO;
  const auto = pickModel({ kind, prompt, quality, aspectRatio });
  const model = isAuto ? auto.model : (getModel(choice) ?? models[0]);
  const shapes = isAuto ? autoAspectRatios(kind) : model.aspectRatios;
  // The length to use right now (the stored one can lag a render behind a model change).
  const length = model.durations ? (model.durations.includes(duration ?? -1) ? duration : model.durations[0]) : undefined;
  const cost = estimateCost(model, length, kind === "video" && sound);
  const costWith = estimateCost(model, length, true);
  const costWithout = estimateCost(model, length, false);

  // Load the saved gallery once, in the browser.
  useEffect(() => {
    setItems(loadItems());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) saveItems(items);
  }, [items, loaded]);

  // Keep choices valid when switching between image and video or between models.
  useEffect(() => {
    if (choice !== AUTO && !models.some((m) => m.id === choice)) setChoice(AUTO);
  }, [models, choice]);
  useEffect(() => {
    if (!shapes.includes(aspectRatio)) setAspectRatio(shapes[0]);
  }, [shapes, aspectRatio]);
  useEffect(() => {
    if (!model.durations) {
      if (duration !== undefined) setDuration(undefined);
    } else if (!model.durations.includes(duration ?? -1)) setDuration(model.durations[0]);
  }, [model, duration]);

  const update = useCallback((id: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setOpen((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
  }, []);

  function fail(item: Item, error: string) {
    // If only the add-sound step failed, keep the silent video instead of losing it.
    if (item.stage === "sound" && item.url) return update(item.id, { status: "done", soundError: error });
    update(item.id, { status: "failed", error });
  }

  async function poll(item: Item) {
    if (!item.requestId || polling.current.has(item.id)) return;
    polling.current.add(item.id);
    const started = Date.now();
    const jobModelId = item.jobModelId ?? item.modelId;
    let doneUrl: string | null = null;
    try {
      while (Date.now() - started < 20 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, item.kind === "video" ? 5000 : 2000));
        const res = await fetch(
          `/api/status?modelId=${encodeURIComponent(jobModelId)}&requestId=${encodeURIComponent(item.requestId)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (data.status === "COMPLETED" && data.url) {
          doneUrl = data.url as string;
          break;
        }
        if (data.status === "FAILED" || !res.ok) return fail(item, data.error ?? "Something went wrong.");
      }
      if (!doneUrl) return fail(item, "This took too long. Please try again.");
    } catch {
      return fail(item, "Lost connection while waiting.");
    } finally {
      polling.current.delete(item.id);
    }
    stepDone(item, doneUrl);
  }

  /** A step finished. Silent videos that asked for sound get a second "add sound" step. */
  function stepDone(item: Item, url: string, demo?: boolean) {
    if (item.kind === "video" && item.wantSound && !item.hasAudio && item.stage !== "sound") {
      const next: Item = { ...item, url, demo, stage: "sound" };
      update(item.id, { url, demo, stage: "sound" });
      submitStep(next, ADD_SOUND_MODEL.id, url);
      return;
    }
    update(item.id, {
      status: "done",
      // Demo mode has no real audio, so keep the same placeholder.
      url: item.stage === "sound" && demo ? item.url : url,
      demo,
      hasAudio: item.hasAudio || item.stage === "sound",
      soundError: undefined,
    });
  }

  async function submitStep(item: Item, jobModelId: string, sourceUrl?: string) {
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: jobModelId,
          prompt: item.prompt,
          aspectRatio: item.aspectRatio,
          duration: item.duration,
          sound: item.wantSound,
          sourceUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return fail(item, data.error ?? "Something went wrong.");
      const duration = item.stage === "sound" ? item.duration : (data.duration ?? item.duration);
      const next: Item = { ...item, jobModelId, duration };
      if (data.status === "COMPLETED") return stepDone(next, data.url, data.demo);
      update(item.id, { requestId: data.requestId as string, jobModelId, duration });
      poll({ ...next, requestId: data.requestId as string });
    } catch {
      fail(item, "Couldn't reach the server.");
    }
  }

  // Resume any jobs that were still running when the page was closed.
  useEffect(() => {
    if (!loaded) return;
    items.filter((it) => it.status === "pending" && it.requestId).forEach(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function runJob(spec: JobSpec) {
    const m = getModel(spec.modelId)!;
    const wantSound = spec.kind === "video" ? spec.sound !== false : undefined;
    const item: Item = {
      ...spec,
      id: crypto.randomUUID(),
      modelName: m.name,
      status: "pending",
      createdAt: Date.now(),
      wantSound,
      hasAudio: Boolean(m.audio && wantSound),
      stage: "video",
    };
    setItems((prev) => [item, ...prev]);
    submitStep(item, spec.modelId);
  }

  /** Adds sound to a silent video that's already in the gallery. */
  function addSound(it: Item) {
    if (!it.url) return;
    const next: Item = { ...it, status: "pending", wantSound: true, stage: "sound", soundError: undefined };
    update(it.id, { status: "pending", wantSound: true, stage: "sound", soundError: undefined, requestId: undefined });
    setOpen(null);
    submitStep(next, ADD_SOUND_MODEL.id, it.url);
  }

  function generate() {
    setFormError(null);
    const text = prompt.trim();
    if (!text) {
      setFormError("Describe what you want to create first.");
      return;
    }
    const safety = checkPrompt(text);
    if (!safety.ok) {
      setFormError(safety.reason);
      return;
    }
    if (!hasAcceptedTerms()) {
      setAskTerms(true);
      return;
    }
    runJob({
      kind,
      modelId: model.id,
      prompt: text,
      aspectRatio,
      duration: length,
      sound: kind === "video" ? sound : undefined,
      quality: isAuto ? quality : undefined,
      autoReason: isAuto ? auto.reason : undefined,
      templateName: template?.name,
    });
  }

  /** Re-runs a draft's prompt with the best model for a final version. */
  function makeFinal(draft: Item) {
    const pick = pickModel({ kind: draft.kind, prompt: draft.prompt, quality: "final", aspectRatio: draft.aspectRatio });
    const d = pick.model.durations
      ? (pick.model.durations.find((x) => x >= (draft.duration ?? 0)) ?? pick.model.durations[0])
      : undefined;
    runJob({
      kind: draft.kind,
      modelId: pick.model.id,
      prompt: draft.prompt,
      aspectRatio: pick.model.aspectRatios.includes(draft.aspectRatio) ? draft.aspectRatio : pick.model.aspectRatios[0],
      duration: d,
      quality: "final",
      autoReason: pick.reason,
      parentId: draft.id,
      sound: draft.kind === "video" ? draft.wantSound !== false : undefined,
      templateName: draft.templateName,
    });
    setOpen(null);
  }

  function chooseTemplate(t: Template | null) {
    setTemplate(t);
    setFormError(null);
    if (!t) return;
    const empty: Record<string, string> = {};
    setFields(empty);
    setKind(t.kind);
    setAspectRatio(t.aspectRatio);
    setChoice(AUTO);
    setPrompt(fillTemplate(t, empty));
  }

  function setField(key: string, value: string) {
    if (!template) return;
    const next = { ...fields, [key]: value };
    setFields(next);
    setPrompt(fillTemplate(template, next));
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setOpen(null);
  }

  const shown = items.filter((it) => filter === "all" || it.kind === filter);
  const pendingCount = items.filter((it) => it.status === "pending").length;
  const kindTemplates = TEMPLATES.filter((t) => t.kind === kind);

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
                onClick={() => {
                  setKind(k);
                  if (template && template.kind !== k) setTemplate(null);
                }}
              >
                {k === "image" ? "Image" : "Video"}
              </button>
            ))}
          </div>

          <div className="label">Start from a template</div>
          <div className="templates">
            {kindTemplates.map((t) => (
              <button
                key={t.id}
                className={template?.id === t.id ? "template active" : "template"}
                onClick={() => chooseTemplate(template?.id === t.id ? null : t)}
                title={t.use}
              >
                <span className="template-emoji" aria-hidden>
                  {t.emoji}
                </span>
                <span className="template-name">{t.name}</span>
                <span className="template-use">{t.use}</span>
              </button>
            ))}
          </div>

          {template && (
            <div className="fields">
              {template.fields.map((f) => (
                <label key={f.key} className="field">
                  <span>{f.label}</span>
                  <input
                    value={fields[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}

          <label className="label" htmlFor="prompt">
            {template ? "Your prompt (edit freely)" : `Or describe your ${kind}`}
          </label>
          <textarea
            id="prompt"
            className="prompt"
            rows={template ? 4 : 5}
            maxLength={2000}
            placeholder={EXAMPLES[kind][0]}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
            }}
          />
          {!template && (
            <div className="examples">
              {EXAMPLES[kind].map((ex) => (
                <button key={ex} className="chip" onClick={() => setPrompt(ex)}>
                  {ex.length > 42 ? ex.slice(0, 40) + "..." : ex}
                </button>
              ))}
            </div>
          )}

          <div className="label">Model</div>
          <div className="models">
            <button className={isAuto ? "model active" : "model"} onClick={() => setChoice(AUTO)}>
              <span className="model-name">✨ Auto</span>
              <span className="model-cost">recommended</span>
              <span className="model-tag">Picks the best model for each job, and saves money on drafts.</span>
            </button>
            {models.map((m) => (
              <button
                key={m.id}
                className={!isAuto && m.id === model.id ? "model active" : "model"}
                onClick={() => setChoice(m.id)}
              >
                <span className="model-name">{m.name}</span>
                <span className="model-tag">
                  {m.tagline}
                  {m.kind === "video" && (
                    <span className={m.audio ? "sound-tag on" : "sound-tag"}>
                      {m.audio ? "🔊 Makes its own sound" : "🔇 Silent (sound can be added)"}
                    </span>
                  )}
                </span>
                <span className="model-cost">{m.approxCost}</span>
              </button>
            ))}
          </div>

          {isAuto && (
            <>
              <div className="label">Quality</div>
              <div className="segmented">
                <button className={quality === "draft" ? "seg active" : "seg"} onClick={() => setQuality("draft")}>
                  <strong>Draft</strong>
                  <span>Cheap preview</span>
                </button>
                <button className={quality === "final" ? "seg active" : "seg"} onClick={() => setQuality("final")}>
                  <strong>Final</strong>
                  <span>Best quality</span>
                </button>
              </div>
              <p className="auto-pick">
                Auto will use <strong>{model.name}</strong>: {auto.reason}.
              </p>
            </>
          )}

          <div className="row">
            <div>
              <div className="label">Shape</div>
              <div className="pills">
                {shapes.map((ar) => (
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
                    <button key={d} className={d === length ? "pill active" : "pill"} onClick={() => setDuration(d)}>
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {kind === "video" && (
            <>
              <div className="label">Sound</div>
              <div className="segmented">
                <button className={sound ? "seg active" : "seg"} onClick={() => setSound(true)}>
                  <strong>🔊 With sound</strong>
                  <span>{formatCost(costWith)}</span>
                </button>
                <button className={!sound ? "seg active" : "seg"} onClick={() => setSound(false)}>
                  <strong>🔇 No sound</strong>
                  <span>{formatCost(costWithout)}</span>
                </button>
              </div>
              {sound && (
                <p className="auto-pick">
                  {model.audio
                    ? `${model.name} makes its own sound, including speech.`
                    : `${model.name} is silent, so we add matching sound effects and ambience after (not speech). For speech, use Google Veo 3.`}
                </p>
              )}
            </>
          )}

          {formError && <p className="error">{formError}</p>}
          <button className="generate" onClick={generate} disabled={mode === "locked"}>
            {isAuto && quality === "draft" ? `Generate ${kind} draft` : `Generate ${kind}`}
            {pendingCount > 0 && <span className="count">{pendingCount} running</span>}
          </button>
          <p className="hint">
            {mode === "demo" ? `Free in demo mode (live cost ${formatCost(cost)}).` : `Estimated cost: ${formatCost(cost)}.`}{" "}
            Ctrl/⌘ + Enter to generate.
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
              <p className="muted">
                Pick a template or write a prompt, then press Generate. Start with a cheap draft, and make a final
                version of the ones you like.
              </p>
            </div>
          )}

          <div className="grid">
            {shown.map((it) => (
              <button
                key={it.id}
                className="tile"
                onClick={() => it.status !== "pending" && setOpen(it)}
                title={it.prompt}
              >
                {it.status === "pending" && (
                  <div className="tile-state">
                    <span className="spinner" aria-hidden />
                    <span>
                      {it.stage === "sound"
                        ? "Adding sound..."
                        : `Creating ${it.quality === "draft" ? "draft" : it.quality === "final" ? "final" : it.kind}...`}
                    </span>
                  </div>
                )}
                {it.status === "failed" && (
                  <div className="tile-state failed">
                    <span>Failed</span>
                    <span className="muted small">{it.error}</span>
                  </div>
                )}
                {it.status === "done" && it.url && <Media item={it} thumb />}
                {it.quality && <span className={`tile-quality q-${it.quality}`}>{it.quality === "draft" ? "Draft" : "Final"}</span>}
                <span className="tile-label">
                  {it.kind === "video" ? (it.hasAudio ? "🔊 " : "▶ ") : ""}
                  {it.modelName}
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>You are responsible for what you create with GenStudio.</span>
        <span>
          <Link href="/terms">Terms</Link> · <Link href="/acceptable-use">Acceptable use</Link> ·{" "}
          <Link href="/privacy">Privacy</Link>
        </span>
      </footer>

      {askTerms && (
        <AgreeModal
          onCancel={() => setAskTerms(false)}
          onAgree={() => {
            setAskTerms(false);
            setTimeout(generate, 0);
          }}
        />
      )}

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
                <dd>
                  {open.modelName}
                  {open.autoReason && <span className="muted small"> (Auto: {open.autoReason})</span>}
                </dd>
                {open.quality && (
                  <>
                    <dt>Quality</dt>
                    <dd>{open.quality === "draft" ? "Draft" : "Final"}</dd>
                  </>
                )}
                {open.templateName && (
                  <>
                    <dt>Template</dt>
                    <dd>{open.templateName}</dd>
                  </>
                )}
                {open.kind === "video" && (
                  <>
                    <dt>Sound</dt>
                    <dd>
                      {open.hasAudio ? "Yes" : "No"}
                      {open.soundError && <span className="muted small"> (couldn&apos;t add: {open.soundError})</span>}
                    </dd>
                  </>
                )}
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
              {open.quality === "draft" && open.status === "done" && <FinalButton draft={open} onClick={makeFinal} />}
              {open.kind === "video" && open.status === "done" && !open.hasAudio && open.url && (
                <div className="final-box">
                  <button className="pill active" onClick={() => addSound(open)}>
                    🔊 Add sound
                  </button>
                  <p className="hint">
                    Adds matching sound effects and ambience. About{" "}
                    {formatCost(estimateCost(ADD_SOUND_MODEL, open.duration))}.
                  </p>
                </div>
              )}
              <div className="viewer-actions">
                {open.url && (
                  <button className="pill active" onClick={() => download(open)}>
                    Download
                  </button>
                )}
                <button
                  className="pill"
                  onClick={() => {
                    setTemplate(null);
                    setKind(open.kind);
                    setChoice(open.quality ? AUTO : open.modelId);
                    if (open.quality) setQuality(open.quality);
                    setAspectRatio(open.aspectRatio);
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

function FinalButton({ draft, onClick }: { draft: Item; onClick: (d: Item) => void }) {
  const pick = pickModel({ kind: draft.kind, prompt: draft.prompt, quality: "final", aspectRatio: draft.aspectRatio });
  const d = pick.model.durations?.find((x) => x >= (draft.duration ?? 0)) ?? pick.model.durations?.[0];
  return (
    <div className="final-box">
      <button className="generate small" onClick={() => onClick(draft)}>
        Make final version
      </button>
      <p className="hint">
        Re-creates this with {pick.model.name} ({pick.reason}). About {formatCost(estimateCost(pick.model, d, draft.kind === "video" && draft.wantSound !== false))}.
      </p>
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
