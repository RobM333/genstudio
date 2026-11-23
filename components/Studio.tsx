"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADD_SOUND_MODEL, animateModelFor, EDIT_IMAGE_MODEL, estimateCost, KEYFRAME_MODEL_ID, formatCost, getModel, MODELS, type AspectRatio, type MediaKind } from "@/lib/models";
import { autoAspectRatios, pickModel, type Quality } from "@/lib/router";
import { fillTemplate, TEMPLATES, type Template } from "@/lib/templates";
import type { AppMode } from "@/lib/config";
import { INSPIRATION, TEMPLATE_MEDIA, type ShowcaseMedia } from "@/lib/showcase";
import { checkPrompt } from "@/lib/safety";
import AgreeModal, { hasAcceptedTerms } from "./AgreeModal";
import Link from "next/link";
import { progressView, type Phase } from "@/lib/progress";

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
  enhance?: boolean; // improve the prompt before generating
  enhancedPrompt?: string; // the improved prompt the model actually used
  sourceUrl?: string; // image being fixed
  editPrompt?: string; // instruction sent to the fix model
  fixNote?: string; // what the user asked to change
  stepStartedAt?: number; // when the current step started (or joined the queue)
  phase?: Phase; // waiting in line, or being made
  queuePosition?: number;
  purpose?: "keyframe" | "animate"; // picture-first video steps
  keyframeFor?: KeyframePlan; // this picture is the first frame of a planned video
  enhanceNote?: string; // what the booster simplified, in plain words
};

type KeyframePlan = { videoModelId: string; duration?: number; sound: boolean; quality?: Quality; autoReason?: string };

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
  enhance?: boolean;
  sourceUrl?: string;
  editPrompt?: string;
  fixNote?: string;
  purpose?: "keyframe" | "animate";
  keyframeFor?: KeyframePlan;
};

const AUTO = "auto";
type View = "home" | "create" | "templates" | "gallery";
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
  const [enhance, setEnhance] = useState(true);
  const [pictureFirst, setPictureFirst] = useState(true);
  const [askTerms, setAskTerms] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [template, setTemplate] = useState<Template | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | MediaKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
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
  const keyframeCost = estimateCost(getModel(KEYFRAME_MODEL_ID)!);
  const nowCost = kind === "video" && pictureFirst ? keyframeCost : cost;

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
        if (data.status === "IN_QUEUE" || data.status === "IN_PROGRESS") {
          const phase: Phase = data.status === "IN_QUEUE" ? "queue" : "working";
          setItems((prev) =>
            prev.map((x) =>
              x.id !== item.id
                ? x
                : {
                    ...x,
                    phase,
                    queuePosition: data.queuePosition,
                    // Start the clock when the job actually starts, not while it waits in line.
                    stepStartedAt: x.phase === "queue" && phase === "working" ? Date.now() : (x.stepStartedAt ?? Date.now()),
                  },
            ),
          );
        }
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
      update(item.id, { url, demo, stage: "sound", enhancedPrompt: item.enhancedPrompt, enhanceNote: item.enhanceNote });
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
      enhancedPrompt: item.enhancedPrompt,
      enhanceNote: item.enhanceNote,
    });
  }

  async function submitStep(item: Item, jobModelId: string, sourceUrl?: string) {
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: jobModelId,
          prompt: item.stage !== "sound" && item.editPrompt ? item.editPrompt : item.prompt,
          aspectRatio: item.aspectRatio,
          duration: item.duration,
          sound: item.wantSound,
          sourceUrl,
          enhance: item.stage !== "sound" && item.enhance !== false,
          purpose: item.stage !== "sound" ? item.purpose : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return fail(item, data.error ?? "Something went wrong.");
      const duration = item.stage === "sound" ? item.duration : (data.duration ?? item.duration);
      const enhancedPrompt = item.stage === "sound" ? item.enhancedPrompt : (data.enhancedPrompt as string | undefined);
      const enhanceNote = item.stage === "sound" ? item.enhanceNote : (data.enhanceNote as string | undefined);
      const next: Item = { ...item, jobModelId, duration, enhancedPrompt, enhanceNote };
      if (data.status === "COMPLETED") return stepDone(next, data.url, data.demo);
      update(item.id, {
        requestId: data.requestId as string,
        jobModelId,
        duration,
        enhancedPrompt,
        enhanceNote,
        stepStartedAt: Date.now(),
        phase: "queue",
        queuePosition: undefined,
      });
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
    setSelectedId(item.id);
    setView("create");
    submitStep(item, spec.modelId, spec.sourceUrl);
  }

  /** Adds sound to a silent video that's already in the gallery. */
  function addSound(it: Item) {
    if (!it.url) return;
    const next: Item = { ...it, status: "pending", wantSound: true, stage: "sound", soundError: undefined };
    update(it.id, { status: "pending", wantSound: true, stage: "sound", soundError: undefined, requestId: undefined });
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
    if (kind === "video" && pictureFirst) {
      // Picture first: make a cheap still to check the layout, then animate it.
      runJob({
        kind: "image",
        modelId: KEYFRAME_MODEL_ID,
        prompt: text,
        aspectRatio,
        enhance,
        purpose: "keyframe",
        autoReason: "first frame of your video, check it before paying for video",
        templateName: template?.name,
        keyframeFor: {
          videoModelId: model.id,
          duration: length,
          sound,
          quality: isAuto ? quality : undefined,
          autoReason: isAuto ? auto.reason : undefined,
        },
      });
      return;
    }
    runJob({
      kind,
      modelId: model.id,
      prompt: text,
      aspectRatio,
      duration: length,
      sound: kind === "video" ? sound : undefined,
      enhance,
      quality: isAuto ? quality : undefined,
      autoReason: isAuto ? auto.reason : undefined,
      templateName: template?.name,
    });
  }

  /** Fixes what the user didn't like. Images are edited in place; videos are re-made with the note added. */
  function fixItem(it: Item, note: string, newPrompt?: string): string | null {
    const text = note.trim();
    if (!text) return "Say what you'd like changed.";
    const safety = checkPrompt(text);
    if (!safety.ok) return safety.reason;
    if (newPrompt && !checkPrompt(newPrompt).ok) return "The suggested prompt can't be used. Edit the note instead.";
    // Videos are remade, so a full improved prompt (from Find what's wrong) beats a tacked-on note.
    const prompt = (it.kind === "video" && newPrompt ? newPrompt : `${basePrompt(it)}. Fix: ${text}`).slice(0, 1900);
    const common = {
      kind: it.kind,
      prompt,
      aspectRatio: it.aspectRatio,
      quality: it.quality,
      parentId: it.id,
      templateName: it.templateName,
      fixNote: text,
      keyframeFor: it.keyframeFor,
    };
    if (it.kind === "image" && it.url) {
      runJob({
        ...common,
        modelId: EDIT_IMAGE_MODEL.id,
        sourceUrl: it.url,
        editPrompt: `${text}. Keep everything else in the image exactly the same.`,
        autoReason: "edits the image and keeps everything else",
        enhance: false,
      });
    } else {
      runJob({
        ...common,
        modelId: it.modelId,
        duration: it.duration,
        sound: it.wantSound !== false,
        autoReason: it.autoReason,
        enhance: it.enhance !== false,
        sourceUrl: it.purpose === "animate" ? it.sourceUrl : undefined,
        purpose: it.purpose === "animate" ? "animate" : undefined,
      });
    }
    return null;
  }

  /** Brings an approved first-frame picture to life. */
  function animate(pic: Item) {
    const plan = pic.keyframeFor;
    if (!plan || !pic.url) return;
    const m = animateModelFor(plan.videoModelId);
    runJob({
      kind: "video",
      modelId: m.id,
      prompt: basePrompt(pic),
      aspectRatio: m.aspectRatios.includes(pic.aspectRatio) ? pic.aspectRatio : m.aspectRatios[0],
      duration: fitDuration(m.durations, plan.duration),
      sound: plan.sound,
      quality: plan.quality,
      autoReason: plan.autoReason ?? "animates your approved picture",
      parentId: pic.id,
      templateName: pic.templateName,
      enhance: pic.enhance !== false,
      sourceUrl: pic.url,
      purpose: "animate",
    });
  }

  /** Re-runs a draft's prompt with the best model for a final version. */
  function makeFinal(draft: Item) {
    if (draft.purpose === "animate" && draft.sourceUrl) {
      // Keep the approved first frame; only the video model gets better.
      const pick = pickModel({ kind: "video", prompt: draft.prompt, quality: "final", aspectRatio: draft.aspectRatio });
      const m = animateModelFor(pick.model.id);
      runJob({
        kind: "video",
        modelId: m.id,
        prompt: basePrompt(draft),
        aspectRatio: m.aspectRatios.includes(draft.aspectRatio) ? draft.aspectRatio : m.aspectRatios[0],
        duration: fitDuration(m.durations, draft.duration),
        quality: "final",
        autoReason: pick.reason,
        parentId: draft.id,
        sound: draft.wantSound !== false,
        templateName: draft.templateName,
        enhance: draft.enhance !== false,
        sourceUrl: draft.sourceUrl,
        purpose: "animate",
      });
      return;
    }
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
      enhance: draft.enhance !== false,
      templateName: draft.templateName,
    });
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
    setSelectedId(null);
  }

  const shown = items.filter((it) => filter === "all" || it.kind === filter);
  const pendingCount = items.filter((it) => it.status === "pending").length;
  const kindTemplates = TEMPLATES.filter((t) => t.kind === kind);
  const selected = items.find((it) => it.id === selectedId) ?? items[0] ?? null;
  const recent = items.slice(0, 12);

  function go(v: View) {
    setView(v);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  function openItem(it: Item) {
    setSelectedId(it.id);
    go("create");
  }

  function startTemplate(t: Template) {
    chooseTemplate(t);
    go("create");
  }

  function reuse(it: Item) {
    setTemplate(null);
    setKind(it.kind);
    setChoice(it.quality ? AUTO : it.modelId);
    if (it.quality) setQuality(it.quality);
    setAspectRatio(it.aspectRatio);
    setPrompt(it.prompt);
  }

  function switchKind(k: MediaKind) {
    setKind(k);
    if (template && template.kind !== k) setTemplate(null);
  }

  // ---------- pieces shared by several views ----------

  const kindTabs = (
    <div className="tabs" role="tablist">
      {(["image", "video"] as MediaKind[]).map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={kind === k}
          className={kind === k ? "tab active" : "tab"}
          onClick={() => switchKind(k)}
        >
          <span className="tab-icon" aria-hidden>
            {k === "image" ? <IconImage /> : <IconVideo />}
          </span>
          {k === "image" ? "Image" : "Video"}
        </button>
      ))}
    </div>
  );

  const templateCard = (t: Template) => (
    <button
      key={t.id}
      className={template?.id === t.id ? "template active" : "template"}
      onClick={() => (view === "create" ? chooseTemplate(template?.id === t.id ? null : t) : startTemplate(t))}
      title={t.use}
      style={{ "--hue": String((TEMPLATES.indexOf(t) * 47 + 190) % 360) } as React.CSSProperties}
    >
      <span className="template-art" aria-hidden>
        <Showcase media={TEMPLATE_MEDIA[t.id]} />
      </span>
      <span className="template-ar">
        {t.kind === "video" ? "Video · " : ""}
        {t.aspectRatio}
      </span>
      <span className="template-meta">
        <span className="template-name">{t.name}</span>
        <span className="template-use">{t.use}</span>
      </span>
    </button>
  );

  const generateButton = (
    <button className="generate" onClick={generate} disabled={mode === "locked"}>
      <span className="generate-label">
        {kind === "video" && pictureFirst
          ? "Make the first frame"
          : isAuto && quality === "draft"
            ? `Generate ${kind} draft`
            : `Generate ${kind}`}
      </span>
      <span className="generate-cost">{mode === "demo" ? "Free" : formatCost(nowCost)}</span>
    </button>
  );

  const notices = (
    <>
      {mode === "demo" && (
        <div className="notice">
          <span className="notice-dot" aria-hidden />
          <span>
            <strong>Demo mode.</strong> No AI service is connected yet, so you get free placeholder results. Everything
            else works for real. Add a fal.ai key to switch on real generation.
          </span>
        </div>
      )}
      {mode === "locked" && (
        <div className="notice warn">
          <span className="notice-dot" aria-hidden />
          <span>
            <strong>Almost live.</strong> A fal.ai key is set, but real generation stays off until you also set an{" "}
            <code>APP_PASSWORD</code>, so strangers can&apos;t spend your credit.
          </span>
        </div>
      )}
    </>
  );

  const tile = (it: Item) => (
    <button
      key={it.id}
      className={`tile tile-${it.aspectRatio.replace(":", "x")} tile-${it.status}`}
      onClick={() => openItem(it)}
      title={it.prompt}
    >
      {it.status === "pending" && <PendingTile item={it} />}
      {it.status === "failed" && (
        <div className="tile-state failed">
          <span>Failed</span>
          <span className="muted small">{it.error}</span>
        </div>
      )}
      {it.status === "done" && it.url && <Media item={it} thumb />}
      {it.quality && <span className={`tile-quality q-${it.quality}`}>{it.quality === "draft" ? "Draft" : "Final"}</span>}
      <span className="tile-overlay">
        <span className="tile-prompt">{it.prompt}</span>
        <span className="tile-label">
          {it.kind === "video" ? (it.hasAudio ? "🔊 " : "▶ ") : ""}
          {it.modelName}
        </span>
      </span>
    </button>
  );

  const inspiration = (
    <div className="inspo">
      {INSPIRATION.map((ex, i) => (
        <button
          key={ex.prompt}
          className="inspo-card"
          style={{ "--hue": String((i * 61 + 200) % 360) } as React.CSSProperties}
          onClick={() => {
            setTemplate(null);
            setKind(ex.kind);
            setPrompt(ex.prompt);
            go("home");
            setTimeout(() => document.getElementById("home-prompt")?.focus(), 50);
          }}
        >
          <Showcase media={ex.media} />
          <span className="inspo-kind">{ex.kind === "image" ? "Image" : "Video"}</span>
          <span className="inspo-text">{ex.prompt}</span>
          <span className="inspo-cta">Use this prompt →</span>
        </button>
      ))}
    </div>
  );

  // ---------- the full settings panel (Create workspace) ----------

  const composer = (
    <section className="panel" aria-label="Create">
      {kindTabs}

      <div className="step" id="templates">
        <div className="step-head">
          <span className="step-num">01</span> Start from a template
          <span className="step-opt">optional</span>
        </div>
        <div className="templates">{kindTemplates.map(templateCard)}</div>

        {template && (
          <div className="fields">
            <div className="fields-head">
              {template.emoji} {template.name}
              <span className="fields-actions">
                <button
                  className="link"
                  onClick={() => {
                    const example = Object.fromEntries(template.fields.map((f) => [f.key, f.placeholder]));
                    setFields(example);
                    setPrompt(fillTemplate(template, example));
                  }}
                >
                  Use this example
                </button>
                <button className="link" onClick={() => chooseTemplate(null)}>
                  Clear
                </button>
              </span>
            </div>
            {template.fields.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <input
                  value={fields[f.key] ?? ""}
                  placeholder={`e.g. ${f.placeholder}`}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="step">
        <label className="step-head" htmlFor="prompt">
          <span className="step-num">02</span> {template ? "Your prompt (edit freely)" : `Describe your ${kind}`}
        </label>
        <div className="prompt-box">
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
          <span className="prompt-count">{prompt.length}/2000</span>
        </div>
        <label className="enhance-toggle">
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
          <span>
            <strong>✨ Enhance my prompt</strong>
            <span className="muted small">
              {" "}
              Adds lighting, camera and style details so results look more professional. Untick to use your exact words.
            </span>
          </span>
        </label>
        {!template && (
          <div className="examples">
            <span className="examples-label">Try:</span>
            {EXAMPLES[kind].map((ex) => (
              <button key={ex} className="chip" onClick={() => setPrompt(ex)}>
                {ex.length > 42 ? ex.slice(0, 40) + "..." : ex}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="step">
        <div className="step-head">
          <span className="step-num">03</span> Model
        </div>
        <div className="models">
          <button className={isAuto ? "model auto active" : "model auto"} onClick={() => setChoice(AUTO)}>
            <span className="model-name">
              <span className="spark" aria-hidden>
                ✦
              </span>{" "}
              Auto <span className="tag tag-rec">Recommended</span>
            </span>
            <span className="model-tag">Picks the best model for each job, and saves money on drafts.</span>
          </button>
          {models.map((m) => (
            <button
              key={m.id}
              className={!isAuto && m.id === model.id ? "model active" : "model"}
              onClick={() => setChoice(m.id)}
            >
              <span className="model-name">
                {m.name}
                {m.kind === "video" && (
                  <span className={m.audio ? "tag tag-sound" : "tag"}>{m.audio ? "🔊 Sound" : "🔇 Silent"}</span>
                )}
              </span>
              <span className="model-tag">
                {m.tagline}
                {m.kind === "video" && !m.audio && <span className="sound-tag"> Sound can be added.</span>}
              </span>
              <span className="model-cost">{m.approxCost}</span>
            </button>
          ))}
        </div>

        {isAuto && (
          <>
            <div className="sub-label">Quality</div>
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
              <span className="spark" aria-hidden>
                ✦
              </span>{" "}
              Auto will use <strong>{model.name}</strong>: {auto.reason}.
            </p>
          </>
        )}
      </div>

      <div className="step">
        <div className="step-head">
          <span className="step-num">04</span> Settings
        </div>
        <div className="row">
          <div>
            <div className="sub-label">Shape</div>
            <div className="pills">
              {shapes.map((ar) => (
                <button key={ar} className={ar === aspectRatio ? "pill active" : "pill"} onClick={() => setAspectRatio(ar)}>
                  <span className={`ar ar-${ar.replace(":", "x")}`} aria-hidden /> {ar}
                </button>
              ))}
            </div>
          </div>
          {model.durations && (
            <div>
              <div className="sub-label">Length</div>
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
            <div className="sub-label">How to start</div>
            <div className="segmented">
              <button className={pictureFirst ? "seg active" : "seg"} onClick={() => setPictureFirst(true)}>
                <strong>🖼️ Picture first</strong>
                <span>recommended</span>
              </button>
              <button className={!pictureFirst ? "seg active" : "seg"} onClick={() => setPictureFirst(false)}>
                <strong>🎬 Straight to video</strong>
                <span>{formatCost(cost)}</span>
              </button>
            </div>
            <p className="auto-pick">
              {pictureFirst
                ? `We make the first frame as a picture (${formatCost(keyframeCost)}) so you can check who is where and fix it cheaply. Then one click animates it (${formatCost(estimateCost(animateModelFor(model.id), length, sound))}).`
                : "Goes straight to video. Faster, but if the layout comes out wrong you pay for the whole video again."}
            </p>
            {sceneWarning(prompt) && <p className="notice warn small-notice">⚠️ {sceneWarning(prompt)}</p>}
          </>
        )}

        {kind === "video" && (
          <>
            <div className="sub-label">Sound</div>
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
      </div>

      <div className="generate-bar">
        {formError && <p className="error">{formError}</p>}
        {generateButton}
        <p className="hint">
          {mode === "demo" ? `Free in demo mode (live cost ${formatCost(nowCost)}).` : `Estimated cost: ${formatCost(nowCost)}.`}{" "}
          <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to generate.
        </p>
      </div>
    </section>
  );

  // ---------- the selected result, shown large ----------

  const filmstrip = recent.length > 1 && (
    <div className="filmstrip" aria-label="History">
      {recent.map((it) => (
        <button
          key={it.id}
          className={selected?.id === it.id ? "film active" : "film"}
          onClick={() => setSelectedId(it.id)}
          title={it.prompt}
        >
          {it.status === "done" && it.url ? <Media item={it} thumb /> : <span className="film-state">{it.status === "failed" ? "!" : <span className="spinner small" />}</span>}
        </button>
      ))}
    </div>
  );

  const stage = selected ? (
    <div className="canvas-wrap">
      <div className={`canvas canvas-${selected.aspectRatio.replace(":", "x")}`}>
        {selected.status === "pending" && <PendingTile item={selected} />}
        {selected.status === "failed" && (
          <div className="tile-state failed">
            <span>Failed</span>
            <span className="muted small">{selected.error}</span>
          </div>
        )}
        {selected.status === "done" && selected.url && <Media item={selected} />}
      </div>
      {filmstrip}

      <div className="details">
        <div className="details-text">
          <p className="viewer-prompt">
            {basePrompt(selected)}
          </p>
          {selected.fixNote && <p className="fix-note">🔧 Fixed: {selected.fixNote}</p>}
          {selected.enhancedPrompt && selected.enhancedPrompt !== selected.prompt && (
            <details className="enhanced-peek">
              <summary>✨ Enhanced prompt used</summary>
              <p>{selected.enhancedPrompt}</p>
              <button
                className="btn"
                onClick={() => {
                  setTemplate(null);
                  setPrompt(selected.enhancedPrompt!);
                  setEnhance(false);
                }}
              >
                Edit this prompt
              </button>
            </details>
          )}
        </div>
        <dl className="meta">
          <dt>Model</dt>
          <dd>
            {selected.modelName}
            {selected.autoReason && <span className="muted small"> (Auto: {selected.autoReason})</span>}
          </dd>
          {selected.quality && (
            <>
              <dt>Quality</dt>
              <dd>{selected.quality === "draft" ? "Draft" : "Final"}</dd>
            </>
          )}
          {selected.templateName && (
            <>
              <dt>Template</dt>
              <dd>{selected.templateName}</dd>
            </>
          )}
          {selected.kind === "video" && (
            <>
              <dt>Sound</dt>
              <dd>
                {selected.hasAudio ? "Yes" : "No"}
                {selected.soundError && <span className="muted small"> (couldn&apos;t add: {selected.soundError})</span>}
              </dd>
            </>
          )}
          <dt>Shape</dt>
          <dd>{selected.aspectRatio}</dd>
          {selected.duration && (
            <>
              <dt>Length</dt>
              <dd>{selected.duration}s</dd>
            </>
          )}
          <dt>Made</dt>
          <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
        </dl>
        {selected.enhanceNote && <p className="enhance-note">💡 {selected.enhanceNote}</p>}
        {selected.status === "done" && selected.url && selected.keyframeFor && <AnimateBox pic={selected} onAnimate={animate} />}
        {selected.status === "done" && selected.url && <FixBox key={selected.id} item={selected} onFix={fixItem} />}
        {selected.quality === "draft" && selected.status === "done" && <FinalButton draft={selected} onClick={makeFinal} />}
        {selected.kind === "video" && selected.status === "done" && !selected.hasAudio && selected.url && (
          <div className="final-box">
            <button className="btn" onClick={() => addSound(selected)}>
              🔊 Add sound
            </button>
            <p className="hint">
              Adds matching sound effects and ambience. About {formatCost(estimateCost(ADD_SOUND_MODEL, selected.duration))}.
            </p>
          </div>
        )}
        <div className="viewer-actions">
          {selected.url && (
            <button className="btn btn-light" onClick={() => download(selected)}>
              Download
            </button>
          )}
          <button className="btn" onClick={() => reuse(selected)}>
            Reuse prompt
          </button>
          <button className="btn btn-danger" onClick={() => remove(selected.id)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="canvas-empty">
      <LogoMark size={44} />
      <h3>Your creation will appear here</h3>
      <p className="muted">Pick a template or describe what you want on the right, then press Generate.</p>
    </div>
  );

  // ---------- views ----------

  const homeView = (
    <div className="home">
      <h1 className="home-title">
        What will you <em>create</em> today?
      </h1>

      <div className="composer-lite">
        <div className="prompt-box">
          <textarea
            id="home-prompt"
            className="prompt"
            rows={3}
            maxLength={2000}
            placeholder={`Describe an ${kind === "image" ? "image" : "video"}... e.g. ${EXAMPLES[kind][0]}`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
            }}
          />
        </div>
        <div className="lite-bar">
          <div className="lite-left">
            <div className="mini-tabs">
              {(["image", "video"] as MediaKind[]).map((k) => (
                <button key={k} className={kind === k ? "active" : ""} onClick={() => switchKind(k)}>
                  {k === "image" ? <IconImage /> : <IconVideo />} {k === "image" ? "Image" : "Video"}
                </button>
              ))}
            </div>
            <select
              className="mini-select"
              aria-label="Model"
              value={isAuto ? `auto:${quality}` : choice}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("auto:")) {
                  setChoice(AUTO);
                  setQuality(v.slice(5) as Quality);
                } else setChoice(v);
              }}
            >
              <option value="auto:draft">✦ Auto · Draft</option>
              <option value="auto:final">✦ Auto · Final</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              className="mini-select"
              aria-label="Shape"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            >
              {shapes.map((ar) => (
                <option key={ar} value={ar}>
                  {ar}
                </option>
              ))}
            </select>
            {kind === "video" && (
              <button
                className={pictureFirst ? "mini-toggle on" : "mini-toggle"}
                onClick={() => setPictureFirst(!pictureFirst)}
                title="Make the first frame as a picture first, so you can check the layout before paying for video."
              >
                {pictureFirst ? "🖼️ Picture first" : "🎬 Straight to video"}
              </button>
            )}
            {kind === "video" && (
              <button className={sound ? "mini-toggle on" : "mini-toggle"} onClick={() => setSound(!sound)}>
                {sound ? "🔊 Sound on" : "🔇 Sound off"}
              </button>
            )}
            <button
              className={enhance ? "mini-toggle on" : "mini-toggle"}
              onClick={() => setEnhance(!enhance)}
              title="Adds lighting, camera and style details. Turn off to use your exact words."
            >
              {enhance ? "✨ Enhance on" : "✨ Enhance off"}
            </button>
            <button className="link" onClick={() => go("create")}>
              More settings
            </button>
          </div>
          {generateButton}
        </div>
        {formError && <p className="error">{formError}</p>}
      </div>

      {notices}

      <section className="home-section">
        <div className="section-head">
          <h2>Start from a template</h2>
          <button className="link" onClick={() => go("templates")}>
            See all {TEMPLATES.length}
          </button>
        </div>
        <div className="template-row">{TEMPLATES.map(templateCard)}</div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2>{items.length ? "Your Studio" : "Ideas to try"}</h2>
          {items.length > 0 && (
            <button className="link" onClick={() => go("gallery")}>
              Open gallery
            </button>
          )}
        </div>
        {items.length ? <div className="recent-row">{items.slice(0, 8).map(tile)}</div> : inspiration}
      </section>
    </div>
  );

  const createView = (
    <div className="workspace">
      <div className="workspace-main">
        {stage}
      </div>
      <div className="workspace-side">{composer}</div>
    </div>
  );

  const templatesView = (
    <div className="page">
      <div className="page-head">
        <h1>Templates</h1>
        <p className="muted">Ready-made ads for stores, socials and YouTube. Pick one, fill in the blanks, and generate.</p>
      </div>
      {(["image", "video"] as MediaKind[]).map((k) => (
        <section key={k} className="home-section">
          <div className="section-head">
            <h2>{k === "image" ? "Images" : "Videos"}</h2>
          </div>
          <div className="template-grid">{TEMPLATES.filter((t) => t.kind === k).map(templateCard)}</div>
        </section>
      ))}
    </div>
  );

  const galleryView = (
    <div className="page">
      <div className="gallery-head">
        <h1>
          Gallery <span className="gallery-count">{items.length}</span>
        </h1>
        <div className="filters">
          {(["all", "image", "video"] as const).map((f) => (
            <button key={f} className={filter === f ? "filter active" : "filter"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "image" ? "Images" : "Videos"}
            </button>
          ))}
        </div>
      </div>
      {loaded && shown.length === 0 && (
        <div className="empty">
          <div className="empty-art" aria-hidden>
            <LogoMark size={44} />
          </div>
          <h3>Nothing here yet</h3>
          <p className="muted">Everything you make is saved here. Try one of these to start.</p>
          {inspiration}
        </div>
      )}
      <div className="grid">{shown.map(tile)}</div>
    </div>
  );

  const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: "home", label: "Home", icon: <IconHome /> },
    { id: "create", label: "Create", icon: <IconSpark /> },
    { id: "templates", label: "Templates", icon: <IconGrid /> },
    { id: "gallery", label: "Gallery", icon: <IconImage /> },
  ];

  return (
    <div className="app">
      <div className="aurora" aria-hidden />

      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="brand" onClick={() => go("home")} aria-label="GenStudio home">
            <LogoMark />
            <span className="wordmark">GenStudio</span>
          </button>
          <ModeBadge mode={mode} />
        </div>

        <button
          className="new-btn"
          onClick={() => {
            setTemplate(null);
            setPrompt("");
            go("home");
            setTimeout(() => document.getElementById("home-prompt")?.focus(), 50);
          }}
        >
          <span aria-hidden>+</span> New creation
        </button>

        <nav className="side-nav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.id} className={view === n.id ? "nav-item active" : "nav-item"} onClick={() => go(n.id)}>
              <span className="nav-icon" aria-hidden>
                {n.icon}
              </span>
              {n.label}
              {n.id === "gallery" && pendingCount > 0 && (
                <span className="nav-badge">
                  <span className="pulse" aria-hidden /> {pendingCount}
                </span>
              )}
            </button>
          ))}
          <div className="nav-divider" />
          <span className="nav-item soon">
            <span className="nav-icon" aria-hidden>
              <IconBrand />
            </span>
            Brand kits <span className="soon-tag">Soon</span>
          </span>
          <span className="nav-item soon">
            <span className="nav-icon" aria-hidden>
              <IconFolder />
            </span>
            Projects <span className="soon-tag">Soon</span>
          </span>
        </nav>

        <div className="recents">
          <div className="recents-head">Recent</div>
          {recent.length === 0 && <p className="recents-empty">Your latest creations will show up here.</p>}
          {recent.map((it) => (
            <button
              key={it.id}
              className={view === "create" && selected?.id === it.id ? "recent active" : "recent"}
              onClick={() => openItem(it)}
              title={it.prompt}
            >
              <span className="recent-thumb">
                {it.status === "done" && it.url ? <Media item={it} thumb /> : <span className="spinner tiny" />}
              </span>
              <span className="recent-text">{it.prompt}</span>
            </button>
          ))}
        </div>

        <footer className="side-foot">
          <Link href="/terms">Terms</Link> · <Link href="/acceptable-use">Acceptable use</Link> ·{" "}
          <Link href="/privacy">Privacy</Link>
          <span className="side-foot-note">You are responsible for what you create with GenStudio.</span>
        </footer>
      </aside>

      <main className="main" id="top">
        {view === "home" && homeView}
        {view === "create" && (
          <>
            {notices}
            {createView}
          </>
        )}
        {view === "templates" && templatesView}
        {view === "gallery" && galleryView}
      </main>

      {askTerms && (
        <AgreeModal
          onCancel={() => setAskTerms(false)}
          onAgree={() => {
            setAskTerms(false);
            setTimeout(generate, 0);
          }}
        />
      )}
    </div>
  );
}

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

function IconBrand() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="10" r="1.5" />
      <circle cx="12" cy="7.5" r="1.5" />
      <circle cx="15.5" cy="10" r="1.5" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** Real example media when we have it, otherwise a moving colour field. */
function Showcase({ media }: { media?: ShowcaseMedia }) {
  const [failed, setFailed] = useState(false);
  if (media && !failed) {
    if (media.kind === "video")
      return (
        <video
          className="showcase"
          src={media.src}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
        />
      );
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="showcase" src={media.src} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <span className="mesh">
      <span className="blob b1" />
      <span className="blob b2" />
      <span className="blob b3" />
    </span>
  );
}

function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="logomark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="gs-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ce1e6" />
          <stop offset="0.5" stopColor="#8b7cff" />
          <stop offset="1" stopColor="#ff8a5b" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#gs-g)" />
      <path d="M16 7.5l2.4 6.1 6.1 2.4-6.1 2.4L16 24.5l-2.4-6.1L7.5 16l6.1-2.4z" fill="#07070a" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="5" width="14" height="14" rx="3" />
      <path d="M16 10l6-3v10l-6-3z" />
    </svg>
  );
}

function typicalSeconds(it: Item): number {
  const m = getModel(it.jobModelId ?? it.modelId);
  const base = m?.typicalSeconds ?? (it.kind === "video" ? 120 : 10);
  if (m?.kind === "video" && !m.needsSource && it.duration && m.durations?.[0]) return base * (it.duration / m.durations[0]);
  return base;
}

function PendingTile({ item }: { item: Item }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const silentNeedsSound = item.kind === "video" && item.wantSound && !getModel(item.modelId)?.audio;
  const steps = silentNeedsSound ? 2 : 1;
  const step = item.stage === "sound" && steps === 2 ? 2 : 1;
  const what = item.quality === "draft" ? "draft" : item.quality === "final" ? "final" : item.kind;
  const view = item.requestId
    ? progressView({
        phase: item.phase ?? "queue",
        queuePosition: item.queuePosition,
        elapsedSec: (now - (item.stepStartedAt ?? now)) / 1000,
        typicalSec: typicalSeconds(item),
        step,
        steps,
        stepLabel: item.stage === "sound" ? "Adding sound" : item.fixNote ? "Fixing" : `Creating ${what}`,
      })
    : { percent: 1, label: item.enhance !== false ? "Improving your prompt" : "Sending", timeLeft: "starting" };
  return (
    <div className="tile-state">
      <span className="progress-label">{view.label}</span>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(view.percent)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${view.percent}%` }} />
      </div>
      <span className="muted small">{view.timeLeft}</span>
    </div>
  );
}

function AnimateBox({ pic, onAnimate }: { pic: Item; onAnimate: (p: Item) => void }) {
  const plan = pic.keyframeFor!;
  const m = animateModelFor(plan.videoModelId);
  const d = fitDuration(m.durations, plan.duration);
  return (
    <div className="final-box">
      <button className="generate small" onClick={() => onAnimate(pic)}>
        🎬 Looks right, animate it
      </button>
      <p className="hint">
        Turns this picture into a {d}s video with {m.name.replace(" (animate)", "")}
        {plan.sound ? ", with sound" : ""}. About {formatCost(estimateCost(m, d, plan.sound))}. If something is off, fix the
        picture first below. It&apos;s much cheaper than fixing the video.
      </p>
    </div>
  );
}

type Analysis = { problems: string[]; fix: string; prompt: string };

function FixBox({ item, onFix }: { item: Item; onFix: (it: Item, note: string, newPrompt?: string) => string | null }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const m = getModel(item.modelId);
  const isImage = item.kind === "image";
  const cost = isImage ? estimateCost(EDIT_IMAGE_MODEL) : m ? estimateCost(m, item.duration, item.wantSound !== false) : 0;
  const analyzeCost = isImage ? 0.01 : 0.01 * Math.ceil((item.duration ?? 5) / 5);

  async function analyze() {
    setError(null);
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, url: item.url, prompt: basePrompt(item) }),
      });
      let data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't analyze this.");
      const started = Date.now();
      while (data.status !== "COMPLETED") {
        if (data.status === "FAILED") throw new Error(data.error ?? "The analysis failed.");
        if (Date.now() - started > 3 * 60 * 1000) throw new Error("The analysis took too long. Try again.");
        await new Promise((r) => setTimeout(r, 2000));
        const r = await fetch(`/api/analyze?kind=${item.kind}&requestId=${encodeURIComponent(data.requestId)}`);
        const next = await r.json().catch(() => ({}));
        data = { ...next, requestId: data.requestId };
      }
      const a = data.analysis as Analysis;
      setAnalysis(a);
      if (a.problems.length === 0) setError("No clear problems found. Describe what you'd like changed.");
      else setNote(isImage && a.fix ? a.fix : a.problems.join(" "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="fix-box">
      <label className="label" htmlFor="fix-note">
        Something not right?
      </label>
      <button className="pill" onClick={analyze} disabled={analyzing}>
        {analyzing ? "Looking closely..." : `🔍 Find what's wrong (${formatCost(analyzeCost)})`}
      </button>
      {analysis && analysis.problems.length > 0 && (
        <ul className="problems">
          {analysis.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <textarea
        id="fix-note"
        className="prompt fix-input"
        rows={3}
        maxLength={500}
        placeholder={isImage ? 'e.g. The text should say "I TRIED IT", not IT twice' : "e.g. The hoop should be on the right and the boy should face the court"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button
        className="pill active"
        onClick={() => setError(onFix(item, note, !isImage && analysis?.prompt ? analysis.prompt : undefined))}
      >
        🔧 Fix this
      </button>
      <p className="hint">
        {isImage
          ? "Changes just what you describe and keeps the rest. "
          : item.purpose === "animate"
            ? "Makes the video again from the same picture, with your note. "
            : "Videos can't be edited in place, so we make it again with your note. "}
        About {formatCost(cost)}.
      </p>
    </div>
  );
}

function FinalButton({ draft, onClick }: { draft: Item; onClick: (d: Item) => void }) {
  const pick = pickModel({ kind: draft.kind, prompt: draft.prompt, quality: "final", aspectRatio: draft.aspectRatio });
  const d = pick.model.durations?.find((x) => x >= (draft.duration ?? 0)) ?? pick.model.durations?.[0];
  return (
    <div className="final-box">
      <button className="generate small" onClick={() => onClick(draft)}>
        <span className="spark" aria-hidden>
          ✦
        </span>{" "}
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
  return (
    <span className={`badge badge-${mode}`}>
      <span className="badge-dot" aria-hidden /> {text}
    </span>
  );
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

/** The user's own words, without any "Fix:" notes added later. */
function basePrompt(it: Item): string {
  const i = it.prompt.indexOf(". Fix: ");
  return i === -1 ? it.prompt : it.prompt.slice(0, i);
}

/** The shortest length a model offers that is at least the wanted length. */
function fitDuration(options: number[] | undefined, wanted?: number): number | undefined {
  if (!options) return undefined;
  return options.find((x) => x >= (wanted ?? 0)) ?? options[options.length - 1];
}

/** A friendly warning when a video prompt describes more than one short clip can show. */
function sceneWarning(prompt: string): string | null {
  const p = prompt.trim();
  if (!p) return null;
  const words = p.split(/\s+/).length;
  const sentences = p.split(/[.!?]+\s/).filter((x) => x.trim().length > 3).length;
  const storyWords = (p.toLowerCase().match(/\b(then|after that|afterwards|later|meanwhile|while|as the|as he|as she|and you see|suddenly|finally)\b/g) ?? []).length;
  if (words > 35 || sentences >= 3 || storyWords >= 2 || (sentences >= 2 && storyWords >= 1)) {
    return "This sounds like several moments. A 5 to 10 second clip can show about one, so we'll focus on the main moment. Picture first lets you check the layout before paying for video.";
  }
  return null;
}
