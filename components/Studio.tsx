"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADD_SOUND_MODEL, animateModelFor, EDIT_IMAGE_MODEL, estimateCost, KEYFRAME_MODEL_ID, REFERENCE_IMAGE_MODEL, formatCost, COST_NOTE, getModel, MODELS, type AspectRatio, type MediaKind } from "@/lib/models";
import { autoAspectRatios, pickModel, type Quality } from "@/lib/router";
import { fillTemplate, TEMPLATES, type Template } from "@/lib/templates";
import type { AppMode } from "@/lib/config";
import { INSPIRATION, TEMPLATE_MEDIA, type ShowcaseMedia } from "@/lib/showcase";
import { checkPrompt } from "@/lib/safety";
import AgreeModal, { hasAcceptedTerms } from "./AgreeModal";
import Link from "next/link";
import { progressView, type Phase } from "@/lib/progress";
import ReferencesBox, { loadRefs, saveRefs, type RefItem } from "./ReferencesBox";
import { addSoundTo, animateShot, joinShots, lastFrame, planStory, startPicture, type Story } from "./storyRunner";
import { lengthAdvice, LONG_LENGTHS, MAX_STORY_SECONDS, type ShotPlan } from "@/lib/storyboard";
import { nextLength, readChat } from "@/lib/chat";
import { AD_LENGTHS, AD_PRICES, AD_TONES, AD_VOICES, adCost, endCardSeconds, maxVoiceWords, SCENE_SECONDS, sceneCount, sceneRemakeCost, type AdBrief, type AdPlan } from "@/lib/adplan";
import { AD_T2V, buildAd, changedAdJob, newAdJob, type AdJob } from "./adRunner";

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
  purpose?: "keyframe" | "animate" | "refix"; // picture-first video steps, or a remade fix
  keyframeFor?: KeyframePlan; // this picture is the first frame of a planned video
  enhanceNote?: string; // what the booster simplified, in plain words
  refs?: RefItem[]; // the user's own reference pictures used for this picture
  story?: Story; // a longer video made from several linked shots
  ad?: AdJob; // a full ad: planned scenes, voiceover and music
};

/** Something the chat offers to do, always shown with its price first. */
type ChatAct =
  | { type: "fix"; note: string; how: FixMode; newPrompt?: string }
  | { type: "length"; seconds: number }
  | { type: "final" }
  | { type: "sound" }
  | { type: "video" }
  | { type: "ad"; plan: AdPlan; note: string };
type ChatOffer = { label: string; cost: number; act: ChatAct };
type ChatMsg = {
  id: string;
  thread: string; // the first version this conversation is about
  itemId: string; // the version that was showing when this was said
  from: "you" | "ai";
  text: string;
  problems?: string[];
  offers?: ChatOffer[];
  state?: "open" | "done" | "cancelled" | "working";
  at: number;
};
const CHAT_KEY = "genstudio.chat.v1";

type KeyframePlan = {
  videoModelId: string;
  duration?: number;
  sound: boolean;
  quality?: Quality;
  autoReason?: string;
};

/**
 * Longer videos and videos from your references are made as linked shots behind
 * the scenes. Shots use a silent model; one soundtrack is added at the end.
 */
function storyModels(videoModelId: string) {
  const key = videoModelId.includes("hailuo") || videoModelId.includes("minimax") ? "hailuo" : "kling";
  const shot = animateModelFor(key);
  const first = MODELS.find((m) => m.kind === "video" && m.id.includes(key) && !m.takesImage) ?? shot;
  return { shot, first, seconds: shot.durations?.[0] ?? 5 };
}
function storyCost(videoModelId: string, shots: number, sound: boolean, withRefs = false): number {
  const { shot, seconds } = storyModels(videoModelId);
  return (
    shots * estimateCost(shot, seconds, false) +
    (sound ? estimateCost(ADD_SOUND_MODEL, shots * seconds, true) : 0) +
    (withRefs ? estimateCost(REFERENCE_IMAGE_MODEL) : 0)
  );
}

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
  purpose?: "keyframe" | "animate" | "refix";
  keyframeFor?: KeyframePlan;
  refs?: RefItem[];
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
  // Picture-first is no longer shown: people found the extra picture step confusing.
  const pictureFirst = false;
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
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [plan, setPlan] = useState<ShotPlan | null>(null);
  const [planFor, setPlanFor] = useState<string>("");
  const [storyLen, setStoryLen] = useState<number | null>(null); // null = one clip
  // Create starts as a guided form in the middle; once something is made, the result takes the middle.
  const [composing, setComposing] = useState(true);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatText, setChatText] = useState("");
  const chatLog = useRef<HTMLDivElement>(null);
  const storyRuns = useRef(new Set<string>());
  const adRuns = useRef(new Set<string>());
  // Full ad mode: a brief, then a plan to review and edit, then Build.
  const [adMode, setAdMode] = useState(false);
  const [brief, setBrief] = useState<AdBrief>({ product: "", audience: "", seconds: 15, tone: "Friendly" });
  const [adShape, setAdShape] = useState<AspectRatio>("16:9");
  const [adPlan, setAdPlan] = useState<AdPlan | null>(null);
  const [adBusy, setAdBusy] = useState<string | null>(null);
  const [adError, setAdError] = useState<string | null>(null);
  const [adAsk, setAdAsk] = useState("");
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
  const { seconds: shotSeconds } = storyModels(model.id);
  const storyShots = storyLen !== null ? Math.max(2, Math.round(storyLen / shotSeconds)) : 0;
  const storyOn = kind === "video" && storyLen !== null;
  const nowCost =
    kind === "video" && storyOn
      ? storyCost(model.id, storyShots, sound, refs.length > 0)
      : kind === "video" && refs.length > 0
        ? storyCost(model.id, 1, sound, true)
        : refs.length > 0
          ? keyframeCost
          : cost;

  // Length advisor: once the user pauses typing a video idea, plan it into shots (about $0.001).
  useEffect(() => {
    if (kind !== "video") return;
    const text = prompt.trim();
    const key = `${text}|${storyLen ?? ""}|${shotSeconds}`;
    if (text.split(/\s+/).length < 8 || key === planFor) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, targetSeconds: storyLen ?? undefined, shotSeconds }),
        });
        const data = await res.json().catch(() => ({}));
        setPlanFor(key);
        setPlan(res.ok && data.plan ? (data.plan as ShotPlan) : null);
      } catch {
        // advice is optional
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [kind, prompt, storyLen, shotSeconds, planFor]);

  // Load the saved gallery once, in the browser.
  useEffect(() => {
    setItems(loadItems());
    setRefs(loadRefs());
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      const list = raw ? (JSON.parse(raw) as ChatMsg[]) : [];
      if (Array.isArray(list)) setChat(list.map((m) => (m.state === "working" ? { ...m, state: "done" } : m)));
    } catch {
      // no saved chat
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-300)));
    } catch {
      // storage full: the chat just won't be remembered
    }
  }, [chat, loaded]);
  useEffect(() => {
    if (loaded) saveRefs(refs);
  }, [refs, loaded]);
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
          refs: item.stage !== "sound" && item.refs?.length ? item.refs.map(({ url, kind, token }) => ({ url, kind, token })) : undefined,
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
    items.filter((it) => it.status === "pending" && it.requestId && !it.story).forEach(poll);
    // Storyboards that were running when the page closed carry on from the first unfinished shot.
    items.filter((it) => it.status === "pending" && it.story).forEach(runStory);
    items.filter((it) => it.status === "pending" && it.ad).forEach(runAd);
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
    setComposing(false);
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
    const useRefs = refs.length > 0 ? refs : undefined;
    if (kind === "video" && (storyOn || useRefs)) {
      // Longer videos (and videos from your own pictures) are made as linked shots behind the scenes.
      const shots = storyOn && plan && plan.shots.length === storyShots ? plan.shots.map((x) => x.prompt) : storyOn ? [] : [text];
      startStory(text, shots, storyOn ? storyShots : 1, { refs: useRefs, templateName: template?.name });
      return;
    }
    if (kind === "video" && (pictureFirst || useRefs)) {
      // Picture first: make a cheap still to check the layout, then animate it.
      // With reference pictures this is always the way, so your product is right before any video.
      runJob({
        kind: "image",
        modelId: useRefs ? REFERENCE_IMAGE_MODEL.id : KEYFRAME_MODEL_ID,
        refs: useRefs,
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
    if (useRefs) {
      runJob({
        kind: "image",
        modelId: REFERENCE_IMAGE_MODEL.id,
        refs: useRefs,
        prompt: text,
        aspectRatio,
        enhance,
        autoReason: "uses your own reference pictures",
        templateName: template?.name,
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
  function fixItem(it: Item, note: string, newPrompt?: string, how: FixMode = "edit"): string | null {
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
    if (it.story) {
      // Longer videos are re-planned and remade with the fix, behind the scenes.
      startStory(prompt, it.story.shots.length > 1 ? [] : [prompt], Math.max(1, it.story.shots.length || it.story.wantShots || 1), {
        refs: it.story.refs as RefItem[] | undefined,
        parentId: it.id,
        fixNote: text,
        videoModelId: it.story.firstModelId,
        sound: it.story.sound,
        aspectRatio: it.aspectRatio,
      });
      return null;
    }
    if (it.kind === "image" && how === "remake") {
      // Camera, angle or layout changes can't be done by editing: make a fresh picture
      // from the original idea plus the correction, with the layout spelled out.
      runJob({
        ...common,
        modelId: it.refs?.length ? REFERENCE_IMAGE_MODEL.id : KEYFRAME_MODEL_ID,
        refs: it.refs,
        autoReason: "remade with your fix, follows layout and camera directions closely",
        enhance: true,
        purpose: "refix",
      });
    } else if (it.kind === "image" && it.url) {
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

  /** Starts a video made of linked shots; everything happens behind the scenes. */
  function startStory(
    text: string,
    shotPrompts: string[],
    wantShots: number,
    opts: {
      refs?: RefItem[];
      templateName?: string;
      parentId?: string;
      fixNote?: string;
      videoModelId?: string;
      sound?: boolean;
      aspectRatio?: AspectRatio;
    } = {},
  ) {
    const { shot, first, seconds } = storyModels(opts.videoModelId ?? model.id);
    const wantSoundNow = opts.sound ?? sound;
    const shape = opts.aspectRatio ?? aspectRatio;
    const story: Story = {
      shots: shotPrompts.map((prompt) => ({ prompt, status: "waiting" })),
      shotModelId: shot.id,
      firstModelId: first.id,
      shotSeconds: seconds,
      wantShots,
      refs: opts.refs?.map(({ url, kind, token }) => ({ url, kind, token })),
      sound: wantSoundNow,
      soundPrompt: text,
    };
    const ar = shot.aspectRatios.includes(shape) ? shape : shot.aspectRatios[0];
    const item: Item = {
      id: crypto.randomUUID(),
      kind: "video",
      modelId: shot.id,
      modelName: wantShots > 1 ? `${first.name} · ${wantShots * seconds}s` : first.name,
      prompt: text,
      aspectRatio: ar,
      duration: wantShots * seconds,
      status: "pending",
      createdAt: Date.now(),
      templateName: opts.templateName,
      parentId: opts.parentId,
      fixNote: opts.fixNote,
      wantSound: wantSoundNow,
      hasAudio: false,
      enhance,
      autoReason:
        wantShots > 1
          ? `${wantShots * seconds}s video made as ${wantShots} linked shots, so every moment fits`
          : "uses your own pictures",
      story,
    };
    setItems((prev) => [item, ...prev]);
    setSelectedId(item.id);
    setView("create");
    setComposing(false);
    runStory(item);
  }

  // ---------- Full ad ----------

  async function planAd(request?: string) {
    setAdError(null);
    if (!brief.product.trim()) {
      setAdError("Tell us what you're advertising first.");
      return;
    }
    if (!hasAcceptedTerms()) {
      setAskTerms(true);
      return;
    }
    setAdBusy(request ? "Updating the plan..." : "Planning your ad...");
    try {
      const res = await fetch("/api/adplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: { ...brief, refKinds: refs.map((r) => r.kind) }, plan: request ? adPlan : undefined, request }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.plan) throw new Error(data.error ?? "Couldn't plan the ad. Please try again.");
      setAdPlan(data.plan as AdPlan);
      if (request) setAdAsk("");
    } catch (e) {
      setAdError((e as Error).message);
    } finally {
      setAdBusy(null);
    }
  }

  function editScene(i: number, patch: Partial<AdPlan["scenes"][number]>) {
    setAdPlan((p) => (p ? { ...p, scenes: p.scenes.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : p));
  }
  function editPlan(patch: Partial<AdPlan>) {
    setAdPlan((p) => (p ? { ...p, ...patch } : p));
  }

  function startAd(job: AdJob, opts: { parentId?: string; fixNote?: string; aspectRatio: AspectRatio }) {
    const item: Item = {
      id: crypto.randomUUID(),
      kind: "video",
      modelId: AD_T2V,
      modelName: `Full ad · ${job.plan.seconds}s`,
      prompt: job.plan.title + ". " + job.plan.concept,
      aspectRatio: opts.aspectRatio,
      duration: job.plan.seconds,
      status: "pending",
      createdAt: Date.now(),
      parentId: opts.parentId,
      fixNote: opts.fixNote,
      wantSound: true,
      hasAudio: false,
      enhance: true,
      autoReason: `${job.plan.scenes.length} scenes, an end card, voiceover and music`,
      ad: job,
    };
    setItems((prev) => [item, ...prev]);
    setSelectedId(item.id);
    setView("create");
    setComposing(false);
    runAd(item);
  }

  function buildPlannedAd() {
    if (!adPlan) return;
    const useRefs = refs.map(({ url, kind, token }) => ({ url, kind, token }));
    startAd(newAdJob({ ...brief, refKinds: refs.map((r) => r.kind) }, adPlan, useRefs), { aspectRatio: adShape });
  }

  /** Makes every missing part of an ad, then joins and mixes. Safe to call again to resume. */
  async function runAd(start: Item) {
    if (!start.ad || adRuns.current.has(start.id)) return;
    adRuns.current.add(start.id);
    const job: AdJob = JSON.parse(JSON.stringify(start.ad));
    const save = (j: AdJob, patch: Partial<Item> = {}) => update(start.id, { ad: JSON.parse(JSON.stringify(j)), ...patch });
    try {
      update(start.id, { status: "pending", error: undefined, stepStartedAt: Date.now(), phase: "working" });
      const out = await buildAd(job, start.aspectRatio, save);
      job.step = undefined;
      save(job, { status: "done", url: out.url, hasAudio: out.hasAudio, stage: "sound" });
    } catch (e) {
      job.step = undefined;
      save(job, { status: "failed", error: (e as Error).message || "A scene failed." });
    } finally {
      adRuns.current.delete(start.id);
    }
  }

  /** Price of a new version after a plan change: only changed parts are made again. */
  function adChangeCost(old: AdJob, plan: AdPlan): number {
    const c = changedAdJob(old, plan);
    const withRefs = Boolean(old.refs?.length);
    return (
      c.scenes * (AD_PRICES.scene + AD_PRICES.picture) +
      (c.card ? AD_PRICES.picture + endCardSeconds(plan.seconds) * AD_PRICES.cardPerSecond : 0) +
      (!withRefs && old.plan.look !== plan.look ? AD_PRICES.picture : 0) +
      (c.voiceChars / 1000) * AD_PRICES.voicePer1000Chars +
      (c.music ? AD_PRICES.musicPerMinute * Math.ceil(plan.seconds / 60) : 0) +
      plan.seconds * AD_PRICES.editPerSecond * 2
    );
  }

  /** Works out a change to a finished ad from plain words, then offers it with its price. */
  async function proposeAdChange(it: Item, thread: string, request: string) {
    const job = it.ad!;
    const id = say(thread, it.id, { text: "Working out which parts need to change...", state: "working" });
    let plan: AdPlan | null = null;
    try {
      const res = await fetch("/api/adplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: job.brief, plan: job.plan, request }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.plan) plan = data.plan as AdPlan;
    } catch {
      // fall back below
    }
    if (!plan) {
      // Without the planner, a "scene 2: ..." note is added to that scene.
      const m = request.match(/scene\s*(\d+)/i);
      const i = m ? Number(m[1]) - 1 : -1;
      if (i >= 0 && i < job.plan.scenes.length)
        plan = { ...job.plan, scenes: job.plan.scenes.map((x, j) => (j === i ? { ...x, visual: `${x.visual}. Change: ${request.replace(/scene\s*\d+\s*[:,-]?/i, "").trim()}` } : x)) };
    }
    patchMsg(id, { state: "done" });
    if (!plan) {
      say(thread, it.id, { text: `I couldn't work that out. Try naming the part, like "scene 2: make it at night", "music: calmer" or "end card: say Shop now".` });
      return;
    }
    const c = changedAdJob(job, plan);
    const parts = [
      c.scenes ? `${c.scenes} scene${c.scenes > 1 ? "s" : ""}` : "",
      c.card ? "the end card" : "",
      c.voiceChars ? "the voiceover" : "",
      c.music ? "the music" : "",
    ].filter(Boolean);
    if (parts.length === 0) {
      say(thread, it.id, { text: "That wouldn't change anything in the ad. Tell me which scene, the voiceover, the music or the end card you'd like different." });
      return;
    }
    const cost = adChangeCost(job, plan);
    say(thread, it.id, {
      text: `I'll remake ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")} and keep everything else as it is. That costs ${price(cost)}.`,
      offers: [{ label: "🔧 Make the change", cost, act: { type: "ad", plan, note: request } }],
      state: "open",
    });
  }

  /** Makes every unfinished shot in order, then joins them and adds sound. Safe to call again to resume. */
  async function runStory(start: Item) {
    if (!start.story || storyRuns.current.has(start.id)) return;
    storyRuns.current.add(start.id);
    let story: Story = { ...start.story, interrupted: false, shots: start.story.shots.map((x) => ({ ...x })) };
    const save = (patch: Partial<Item> = {}) => update(start.id, { story: { ...story, shots: story.shots.map((x) => ({ ...x })) }, ...patch });
    try {
      update(start.id, { status: "pending", error: undefined, stepStartedAt: Date.now(), phase: "working" });
      if (story.shots.length === 0) {
        story.step = "Planning the shots";
        save({ jobModelId: "fal-ai/any-llm" });
        const prompts = await planStory(start.prompt, story.shotSeconds, (story.wantShots ?? 2) * story.shotSeconds);
        story.shots = prompts.map((prompt) => ({ prompt, status: "waiting" as const }));
        save();
      }
      if (story.refs?.length && !story.startUrl) {
        story.step = "Placing your product";
        save({ stepStartedAt: Date.now(), jobModelId: "fal-ai/nano-banana/edit" });
        story.startUrl = await startPicture(story, start.prompt, start.aspectRatio);
        save();
      }
      const n = story.shots.length;
      for (let i = 0; i < n; i++) {
        const shot = story.shots[i];
        if (shot.url && (shot.lastFrame || i === n - 1)) continue;
        story.step = `Shot ${i + 1} of ${n}`;
        shot.status = "working";
        shot.error = undefined;
        save({ stepStartedAt: Date.now(), jobModelId: story.shotModelId });
        try {
          shot.url = await animateShot(story, i, start.aspectRatio);
          // The next shot continues from this one's last frame.
          if (i < n - 1) shot.lastFrame = await lastFrame(shot.url);
          shot.status = "done";
        } catch (e) {
          shot.status = "failed";
          shot.error = (e as Error).message;
          save();
          throw e;
        }
        save();
      }
      story.step = "Joining the shots";
      story.joinedUrl = undefined;
      save({ stepStartedAt: Date.now(), jobModelId: "fal-ai/ffmpeg-api/merge-videos" });
      const joined = await joinShots(story.shots.map((x) => x.url!));
      story.joinedUrl = joined;
      let finalUrl = joined;
      let hasAudio = false;
      if (story.sound) {
        story.step = "Adding sound";
        save({ stepStartedAt: Date.now(), jobModelId: ADD_SOUND_MODEL.id });
        try {
          finalUrl = await addSoundTo(joined, story.soundPrompt, n * story.shotSeconds, start.aspectRatio);
          hasAudio = true;
        } catch {
          // Keep the silent video; the user can add sound again from the viewer.
        }
      }
      story.step = undefined;
      save({ status: "done", url: finalUrl, hasAudio, stage: hasAudio ? "sound" : "video" });
    } catch (e) {
      story.step = undefined;
      save({ status: "failed", error: (e as Error).message || "A shot failed." });
    } finally {
      storyRuns.current.delete(start.id);
    }
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
    if (draft.refs?.length) {
      // Pictures made from your references stay on the model that can use them.
      runJob({
        kind: "image",
        modelId: REFERENCE_IMAGE_MODEL.id,
        refs: draft.refs,
        prompt: draft.prompt,
        aspectRatio: draft.aspectRatio,
        quality: "final",
        autoReason: "uses your own reference pictures",
        parentId: draft.id,
        enhance: draft.enhance !== false,
        templateName: draft.templateName,
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
    setComposing(false);
    go("create");
  }

  function newCreation() {
    setTemplate(null);
    setPrompt("");
    setComposing(true);
    go("create");
    setTimeout(() => document.getElementById("prompt")?.focus(), 50);
  }

  function startTemplate(t: Template) {
    chooseTemplate(t);
    setComposing(true);
    go("create");
  }

  /** Opens the Create form again with this result's settings filled in. A full ad comes back with its plan, ready to edit and rebuild. */
  function reuse(it: Item) {
    setTemplate(null);
    setFormError(null);
    setAdError(null);
    if (it.ad) {
      setAdMode(true);
      setBrief({ product: it.ad.brief.product, audience: it.ad.brief.audience, seconds: it.ad.brief.seconds, tone: it.ad.brief.tone });
      setAdShape(it.aspectRatio);
      setAdPlan(JSON.parse(JSON.stringify(it.ad.plan)) as AdPlan);
      if (it.ad.refs?.length) setRefs(it.ad.refs.map((r) => ({ ...r, kind: r.kind as RefItem["kind"] })));
      setComposing(true);
      go("create");
      return;
    }
    setAdMode(false);
    setKind(it.kind);
    // Videos made from linked shots or from a picture go back to the matching text-to-video model.
    const pickable = MODELS.some((m) => m.id === it.modelId);
    setChoice(it.quality || !pickable ? AUTO : it.modelId);
    if (it.quality) setQuality(it.quality);
    setAspectRatio(it.aspectRatio);
    setPrompt(basePrompt(it));
    if (it.kind === "video") {
      if (it.story && (it.duration ?? 0) > 10) setStoryLen(LONG_LENGTHS.find((d) => d >= (it.duration ?? 0)) ?? MAX_STORY_SECONDS);
      else {
        setStoryLen(null);
        if (it.duration) setDuration(it.duration);
      }
    }
    setComposing(true);
    go("create");
    setTimeout(() => document.getElementById("prompt")?.focus(), 80);
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
        {storyOn
          ? `Generate ${storyShots * shotSeconds}s video`
          : refs.length > 0 && kind === "image"
            ? "Generate with your references"
            : `Generate ${kind}`}
      </span>
      <span className="generate-cost">{mode === "demo" ? "Free" : `est. ${formatCost(nowCost)}`}</span>
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

  // ---------- chat about the selected result ----------

  /** The first version of a picture or video; every fix and remake hangs off it. */
  function rootOf(id: string): string {
    let cur = items.find((x) => x.id === id);
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = items.find((x) => x.id === cur!.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? id;
  }

  const price = (c: number) => (mode === "demo" ? `nothing in demo mode (about ${formatCost(c)} live)` : `about ${formatCost(c)}`);

  function say(thread: string, itemId: string, msg: Partial<ChatMsg> & { text: string }): string {
    const id = crypto.randomUUID();
    setChat((prev) => [...prev, { id, thread, itemId, from: "ai", at: Date.now(), ...msg }]);
    return id;
  }
  function patchMsg(id: string, patch: Partial<ChatMsg>) {
    setChat((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function fixCost(it: Item, how: FixMode): number {
    if (it.story)
      return storyCost(it.story.firstModelId, Math.max(1, it.story.shots.length || it.story.wantShots || 1), it.story.sound, !!it.story.refs?.length);
    if (it.kind === "image")
      return how === "remake"
        ? estimateCost(it.refs?.length ? REFERENCE_IMAGE_MODEL : getModel(KEYFRAME_MODEL_ID)!)
        : estimateCost(EDIT_IMAGE_MODEL);
    const m = getModel(it.modelId);
    return m ? estimateCost(m, it.duration, it.wantSound !== false) : 0;
  }

  function finalCost(draft: Item): number {
    if (draft.refs?.length) return estimateCost(REFERENCE_IMAGE_MODEL);
    const pick = pickModel({ kind: draft.kind, prompt: draft.prompt, quality: "final", aspectRatio: draft.aspectRatio });
    const m = draft.purpose === "animate" ? animateModelFor(pick.model.id) : pick.model;
    return estimateCost(m, fitDuration(m.durations, draft.duration), draft.kind === "video" && draft.wantSound !== false);
  }

  /** How a video gets to a new length: one clip if a model can do it, otherwise linked shots. */
  function lengthPlan(it: Item, seconds: number) {
    const base = it.story ? it.story.firstModelId : it.modelId;
    const m = getModel(base);
    const maxSingle = m?.durations ? Math.max(...m.durations) : 0;
    const single = !it.story && !!m && seconds <= maxSingle;
    const { seconds: shotLen } = storyModels(base);
    const shots = Math.max(2, Math.round(seconds / shotLen));
    const total = single ? fitDuration(m!.durations, seconds)! : shots * shotLen;
    const snd = it.wantSound !== false;
    const cost = single ? estimateCost(m!, total, snd) : storyCost(base, shots, snd, !!it.story?.refs?.length);
    return { base, single, shots, total, cost };
  }

  function doLength(it: Item, seconds: number) {
    const p = lengthPlan(it, seconds);
    const note = `Made it ${p.total}s`;
    if (p.single) {
      runJob({
        kind: "video",
        modelId: it.modelId,
        prompt: basePrompt(it),
        aspectRatio: it.aspectRatio,
        duration: p.total,
        sound: it.wantSound !== false,
        quality: it.quality,
        autoReason: it.autoReason,
        parentId: it.id,
        templateName: it.templateName,
        enhance: it.enhance !== false,
        sourceUrl: it.purpose === "animate" ? it.sourceUrl : undefined,
        purpose: it.purpose === "animate" ? "animate" : undefined,
        fixNote: note,
      });
    } else {
      startStory(basePrompt(it), [], p.shots, {
        refs: it.story?.refs as RefItem[] | undefined,
        parentId: it.id,
        fixNote: note,
        videoModelId: p.base,
        sound: it.wantSound !== false,
        aspectRatio: it.aspectRatio,
        templateName: it.templateName,
      });
    }
  }

  function videoFromPicture(pic: Item) {
    const pick = pickModel({ kind: "video", prompt: basePrompt(pic), quality: "draft", aspectRatio: pic.aspectRatio });
    const m = animateModelFor(pick.model.id);
    const d = m.durations?.[0];
    return { m, d, cost: estimateCost(m, d, true) };
  }

  function doVideo(pic: Item) {
    if (!pic.url) return;
    const { m, d } = videoFromPicture(pic);
    runJob({
      kind: "video",
      modelId: m.id,
      prompt: basePrompt(pic),
      aspectRatio: m.aspectRatios.includes(pic.aspectRatio) ? pic.aspectRatio : m.aspectRatios[0],
      duration: d,
      sound: true,
      quality: "draft",
      autoReason: "brings your picture to life",
      parentId: pic.id,
      templateName: pic.templateName,
      enhance: pic.enhance !== false,
      sourceUrl: pic.url,
      purpose: "animate",
    });
  }

  function checkItem(it: Item, thread: string) {
    const cost = it.kind === "image" ? 0.01 : 0.01 * Math.ceil((it.duration ?? 5) / 5);
    const id = say(thread, it.id, {
      text: `Looking closely at every part${it.kind === "video" ? ", right to the last frame" : ""}. This costs ${price(cost)}.`,
      state: "working",
    });
    analyzeItem(it)
      .then((a) => {
        patchMsg(id, { state: "done" });
        if (a.problems.length === 0) {
          say(thread, it.id, { text: "I couldn't spot any clear problems. Tell me what you'd like changed and I'll fix it." });
          return;
        }
        if (it.ad) {
          say(thread, it.id, { text: "Here's what I found.", problems: a.problems });
          proposeAdChange(it, thread, `Fix these problems: ${a.problems.join(" ")}`);
          return;
        }
        const note = it.kind === "image" && a.fix ? a.fix : a.problems.join(" ");
        const how: FixMode = it.kind === "image" ? suggestFixMode(note) : "edit";
        say(thread, it.id, {
          text: "Here's what I found. Want me to fix it?",
          problems: a.problems,
          offers: [{ label: "🔧 Fix these", cost: fixCost(it, how), act: { type: "fix", note, how, newPrompt: it.kind === "video" ? a.prompt : undefined } }],
          state: "open",
        });
      })
      .catch((e) => {
        patchMsg(id, { state: "done" });
        say(thread, it.id, { text: (e as Error).message || "The check didn't work. Please try again." });
      });
  }

  /** Reads a chat message, then offers the matching action with its price. Nothing is spent until it's accepted. */
  function sendChat(raw: string) {
    const text = raw.trim();
    const it = selected;
    if (!text || !it) return;
    const thread = rootOf(it.id);
    setChat((prev) => [...prev, { id: crypto.randomUUID(), thread, itemId: it.id, from: "you", text, at: Date.now() }]);
    setChatText("");
    const reply = (msg: Partial<ChatMsg> & { text: string }) => say(thread, it.id, msg);
    if (it.status === "pending") {
      reply({ text: "I'm still making this one. Ask me again once it's ready, or press ＋ New to start something else." });
      return;
    }
    const intent = readChat(text, it.kind);
    if (intent.type === "check") {
      if (!it.url) reply({ text: "This one didn't finish, so there's nothing to check. Tell me what you'd like and I'll make it again." });
      else checkItem(it, thread);
      return;
    }
    if (it.ad) {
      const safe = checkPrompt(text);
      if (!safe.ok) reply({ text: safe.reason ?? "I can't make that change." });
      else proposeAdChange(it, thread, text);
      return;
    }
    if (intent.type === "length") {
      const want = intent.seconds ?? nextLength(it.duration, LONG_LENGTHS);
      const seconds = Math.min(MAX_STORY_SECONDS, Math.max(4, want));
      const p = lengthPlan(it, seconds);
      reply({
        text: `${want > MAX_STORY_SECONDS ? `The longest we make is ${MAX_STORY_SECONDS} seconds. ` : ""}I can make it ${p.total} seconds from the same idea${
          p.single ? "" : ", planned moment by moment so the whole action fits"
        }. That costs ${price(p.cost)}.`,
        offers: [{ label: `Make it ${p.total}s`, cost: p.cost, act: { type: "length", seconds } }],
        state: "open",
      });
      return;
    }
    if (intent.type === "sound") {
      if (it.hasAudio) reply({ text: "This video already has sound. Tell me what you'd like to change about it." });
      else if (!it.url) reply({ text: "This one didn't finish, so there's nothing to add sound to yet." });
      else {
        const cost = estimateCost(ADD_SOUND_MODEL, it.duration);
        reply({ text: `I'll add matching sound effects and ambience (not speech). That costs ${price(cost)}.`, offers: [{ label: "🔊 Add sound", cost, act: { type: "sound" } }], state: "open" });
      }
      return;
    }
    if (intent.type === "video") {
      if (!it.url) {
        reply({ text: "This picture didn't finish, so I can't turn it into a video yet." });
        return;
      }
      const v = videoFromPicture(it);
      reply({
        text: `I'll bring this picture to life as a ${v.d}-second video with sound, using ${v.m.name.replace(" (animate)", "")}. That costs ${price(v.cost)}.`,
        offers: [{ label: "🎬 Make the video", cost: v.cost, act: { type: "video" } }],
        state: "open",
      });
      return;
    }
    if (intent.type === "final") {
      if (it.quality !== "draft") reply({ text: "This is already made with our best model. Tell me what you'd like changed." });
      else {
        const cost = finalCost(it);
        reply({ text: `I'll make it again with our best model, from the same idea. That costs ${price(cost)}.`, offers: [{ label: "✦ Make it higher quality", cost, act: { type: "final" } }], state: "open" });
      }
      return;
    }
    const safety = checkPrompt(text);
    if (!safety.ok) {
      reply({ text: safety.reason ?? "I can't make that change." });
      return;
    }
    if (it.kind === "image") {
      const editOffer: ChatOffer = { label: "✏️ Change just that", cost: fixCost(it, "edit"), act: { type: "fix", note: text, how: "edit" } };
      const remakeOffer: ChatOffer = { label: "🔄 Remake with the fix", cost: fixCost(it, "remake"), act: { type: "fix", note: text, how: "remake" } };
      if (!it.url) {
        reply({ text: `I'll make it again with your change. That costs ${price(remakeOffer.cost)}.`, offers: [remakeOffer], state: "open" });
        return;
      }
      const how = suggestFixMode(text);
      reply({
        text:
          how === "edit"
            ? `I'll change just that and keep everything else the same. That costs ${price(editOffer.cost)}. If it needs a new angle or layout, pick Remake instead.`
            : `That needs a fresh picture (new angle or layout), made from your idea plus the fix. That costs ${price(remakeOffer.cost)}.`,
        offers: how === "edit" ? [editOffer, remakeOffer] : [remakeOffer, editOffer],
        state: "open",
      });
      return;
    }
    const cost = fixCost(it, "edit");
    reply({
      text: `Videos can't be edited in place, so I'll make it again with your change${it.story ? ", shot by shot" : ""}. That costs ${price(cost)}.`,
      offers: [{ label: "🔧 Remake with the fix", cost, act: { type: "fix", note: text, how: "edit" } }],
      state: "open",
    });
  }

  function acceptOffer(msg: ChatMsg, offer: ChatOffer) {
    const it = items.find((x) => x.id === msg.itemId);
    if (!it) {
      say(msg.thread, msg.itemId, { text: "That version was deleted, so I can't change it." });
      patchMsg(msg.id, { state: "cancelled" });
      return;
    }
    const a = offer.act;
    let err: string | null = null;
    if (a.type === "fix") err = fixItem(it, a.note, a.newPrompt, a.how);
    else if (a.type === "length") doLength(it, a.seconds);
    else if (a.type === "final") makeFinal(it);
    else if (a.type === "sound") addSound(it);
    else if (a.type === "video") doVideo(it);
    else if (a.type === "ad" && it.ad) startAd(changedAdJob(it.ad, a.plan).job, { parentId: it.id, fixNote: a.note, aspectRatio: it.aspectRatio });
    if (err) {
      say(msg.thread, it.id, { text: err });
      return;
    }
    patchMsg(msg.id, { state: "done" });
    say(msg.thread, it.id, {
      text:
        a.type === "sound"
          ? "Adding sound now. It plays in the middle when it's ready."
          : "On it. The new version appears in the middle when it's ready, and every version stays in the strip under it.",
    });
  }

  const thread = selected ? rootOf(selected.id) : "";
  const threadMsgs = chat.filter((m) => m.thread === thread);
  useEffect(() => {
    const el = chatLog.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadMsgs.length, selectedId, composing]);

  const chips: { label: string; text: string }[] = [];
  if (selected?.status === "done" && selected.url) {
    chips.push({ label: "🔍 Find what's wrong", text: "Find what's wrong" });
    if (selected.ad) {
      chips.push({ label: "🎙️ Change the voiceover", text: "Make the voiceover warmer and slower" });
      chips.push({ label: "🎵 Different music", text: "music: more upbeat" });
    } else if (selected.kind === "video") {
      const next = nextLength(selected.duration, LONG_LENGTHS);
      if ((selected.duration ?? 0) < MAX_STORY_SECONDS) chips.push({ label: `⏱️ Make it ${next}s`, text: `Make it ${next} seconds` });
      if (!selected.hasAudio) chips.push({ label: "🔊 Add sound", text: "Add sound" });
    } else chips.push({ label: "🎬 Turn into a video", text: "Turn it into a video" });
    if (selected.quality === "draft") chips.push({ label: "✦ Higher quality", text: "Make it higher quality" });
  }

  const chatPanel = selected && (
    <div className="chat">
      <div className="chat-log" ref={chatLog}>
        <div className="chat-msg ai">
          <p>
            Tell me what to change, like{" "}
            {selected.ad
              ? "“scene 2: show it at night”, “music: calmer” or “end card: say Shop now”. I only remake the parts that change"
              : selected.kind === "video"
              ? "“make it slower”, “the dog should be brown” or “make it 15 seconds”"
              : "“make it brighter” or “the text should say SALE”"}
            . I always tell you the estimated price before anything is made. {COST_NOTE}
          </p>
        </div>
        {threadMsgs.map((m) => (
          <div key={m.id} className={`chat-msg ${m.from}`}>
            <p>
              {m.text}
              {m.state === "working" && <span className="spinner tiny chat-spin" />}
            </p>
            {m.problems && (
              <ul className="problems">
                {m.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {m.offers && m.state === "open" && (
              <div className="chat-offers">
                {m.offers.map((o, i) => (
                  <button key={o.label} className={i === 0 ? "pill active" : "pill"} onClick={() => acceptOffer(m, o)} disabled={mode === "locked"}>
                    {o.label} · {mode === "demo" ? "Free" : `est. ${formatCost(o.cost)}`}
                  </button>
                ))}
                <button className="link-btn" onClick={() => patchMsg(m.id, { state: "cancelled" })}>
                  No thanks
                </button>
              </div>
            )}
            {m.state === "cancelled" && <span className="muted small">Skipped</span>}
          </div>
        ))}
      </div>
      {chips.length > 0 && (
        <div className="chat-chips">
          {chips.map((c) => (
            <button key={c.label} className="chip" onClick={() => sendChat(c.text)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          sendChat(chatText);
        }}
      >
        <textarea
          rows={2}
          maxLength={500}
          aria-label="Tell me what to change"
          placeholder="Tell me what to change..."
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendChat(chatText);
            }
          }}
        />
        <button type="submit" className="chat-send" disabled={!chatText.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </div>
  );

  // ---------- the pieces of the Create form ----------

  const describeBlock = (
    <>
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
    <ReferencesBox refs={refs} onChange={setRefs} mode={mode} />
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
    </>
  );

  const templateFields = (
    <>
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
    </>
  );

  const modelBlock = (
    <>
    <div className="models">
      <button className={isAuto ? "model auto active" : "model auto"} onClick={() => setChoice(AUTO)}>
        <span className="model-name">
          <span className="spark" aria-hidden>
            ✦
          </span>{" "}
          Auto <span className="tag tag-rec">Recommended</span>
        </span>
        <span className="model-tag">Picks the best model for each job at a fair price.</span>
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
          <span className="model-cost">
            est. {formatCost(estimateCost(m, m.durations?.[0], false))} {m.kind === "video" ? `per ${m.durations?.[0]}s clip` : "per image"}
          </span>
        </button>
      ))}
    </div>

    {isAuto && (
      <>
        <p className="auto-pick">
          <span className="spark" aria-hidden>
            ✦
          </span>{" "}
          Auto will use <strong>{model.name}</strong>: {auto.reason}.
        </p>
      </>
    )}
    </>
  );

  const settingsBlock = (
    <>
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
              <button
                key={d}
                className={d === length && storyLen === null ? "pill active" : "pill"}
                onClick={() => {
                  setDuration(d);
                  setStoryLen(null);
                }}
              >
                {d}s
              </button>
            ))}
            {kind === "video" &&
              LONG_LENGTHS.map((d) => (
                <button
                  key={d}
                  className={storyLen === d ? "pill active" : "pill"}
                  title="Made from several linked shots"
                  onClick={() => setStoryLen(d)}
                >
                  {d}s
                </button>
              ))}
          </div>
        </div>
      )}
    </div>

    {kind === "video" && (
      <>
        {storyOn ? (
          <div className="story-advice on">
            <strong>
              🎞️ {storyShots * shotSeconds}-second video · est. {formatCost(nowCost)}
            </strong>
            <span className="muted small">
              We plan your idea moment by moment and make it as {storyShots} linked shots, each continuing from the last
              frame of the one before{sound ? ", then add one soundtrack" : ""}. You get one finished video.
            </span>
            <button className="link-btn" onClick={() => setStoryLen(null)}>
              Use one short clip instead
            </button>
          </div>
        ) : (
          lengthAdvice(plan, length) && (
            <div className="story-advice">
              <span>⏱️ {lengthAdvice(plan, length)?.replace(/ We recommend \d+ linked shots\./, "")}</span>
              <button
                className="pill active"
                onClick={() => setStoryLen(Math.min(MAX_STORY_SECONDS, plan!.neededSeconds))}
              >
                Make it {Math.min(MAX_STORY_SECONDS, plan!.neededSeconds)}s ·{" "}
                est. {formatCost(storyCost(model.id, Math.round(Math.min(MAX_STORY_SECONDS, plan!.neededSeconds) / shotSeconds), sound, refs.length > 0))}
              </button>
            </div>
          )
        )}
        {!storyOn && sceneWarning(prompt) && <p className="notice warn small-notice">⚠️ {sceneWarning(prompt)}</p>}
      </>
    )}

    {kind === "video" && (
      <>
        <div className="sub-label">Sound</div>
        <div className="segmented">
          <button className={sound ? "seg active" : "seg"} onClick={() => setSound(true)}>
            <strong>🔊 With sound</strong>
            <span>est. {formatCost(costWith)}</span>
          </button>
          <button className={!sound ? "seg active" : "seg"} onClick={() => setSound(false)}>
            <strong>🔇 No sound</strong>
            <span>est. {formatCost(costWithout)}</span>
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
    </>
  );

  const generateBar = (
    <div className="generate-bar">
      {formError && <p className="error">{formError}</p>}
      {generateButton}
      <p className="hint">
        {mode === "demo" ? `Free in demo mode (live estimate ${formatCost(nowCost)}).` : `Estimated cost: ${formatCost(nowCost)}.`} {COST_NOTE}{" "}
        <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to generate.
      </p>
    </div>
  );

  const modelSummary = (
    <details className="model-more">
      <summary>
        <span className="sub-label-inline">Model</span>
        <strong>{isAuto ? "✦ Auto" : model.name}</strong>
        <span className="muted small">{isAuto ? ` uses ${model.name}` : ""}</span>
        <span className="model-more-cta">Change</span>
      </summary>
      {modelBlock}
    </details>
  );

  // ---------- Full ad: the brief, then the plan to review ----------

  const adBrief = (
    <>
      <section className="g-step">
        <div className="g-head">
          <span className="g-num">2</span>
          <h2>Tell us about your ad</h2>
        </div>
        <label className="sub-label" htmlFor="ad-product">
          What are you advertising?
        </label>
        <div className="prompt-box">
          <textarea
            id="ad-product"
            className="prompt"
            rows={3}
            maxLength={600}
            placeholder="e.g. Glow, a refillable glass water bottle that keeps drinks cold for 24 hours. Launching this month at $29."
            value={brief.product}
            onChange={(e) => setBrief({ ...brief, product: e.target.value })}
          />
        </div>
        <label className="sub-label" htmlFor="ad-audience">
          Who is it for?
        </label>
        <input
          id="ad-audience"
          className="text-input"
          maxLength={300}
          placeholder="e.g. busy commuters and gym-goers in their 20s and 30s"
          value={brief.audience}
          onChange={(e) => setBrief({ ...brief, audience: e.target.value })}
        />
        <ReferencesBox refs={refs} onChange={setRefs} mode={mode} />
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">3</span>
          <h2>Options</h2>
          <span className="step-opt">already set, change if you like</span>
        </div>
        <div className="row">
          <div>
            <div className="sub-label">Length</div>
            <div className="pills">
              {AD_LENGTHS.map((d) => (
                <button key={d} className={brief.seconds === d ? "pill active" : "pill"} onClick={() => setBrief({ ...brief, seconds: d })}>
                  {d}s
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="sub-label">Shape</div>
            <div className="pills">
              {(["16:9", "9:16", "1:1"] as AspectRatio[]).map((ar) => (
                <button key={ar} className={ar === adShape ? "pill active" : "pill"} onClick={() => setAdShape(ar)}>
                  <span className={`ar ar-${ar.replace(":", "x")}`} aria-hidden /> {ar}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sub-label">Tone</div>
        <div className="pills">
          {AD_TONES.map((t) => (
            <button key={t} className={brief.tone === t ? "pill active" : "pill"} onClick={() => setBrief({ ...brief, tone: t })}>
              {t}
            </button>
          ))}
        </div>
        <p className="muted small g-hint">
          {sceneCount(brief.seconds)} scenes of {SCENE_SECONDS} seconds and a {endCardSeconds(brief.seconds)}-second end card with your product name. A {brief.seconds}-second ad usually costs est.{" "}
          {formatCost(sceneCount(brief.seconds) * (AD_PRICES.scene + AD_PRICES.picture) + (refs.length ? 0.06 : 0.1))} to make.
        </p>
      </section>

      <section className="g-step g-go">
        <div className="g-head">
          <span className="g-num">4</span>
          <h2>Plan it</h2>
        </div>
        {adError && <p className="error">{adError}</p>}
        <button className="generate" onClick={() => planAd()} disabled={!!adBusy || mode === "locked"}>
          <span className="generate-label">{adBusy ?? "📝 Plan my ad"}</span>
          <span className="generate-cost">{mode === "demo" ? "Free" : "under 1 cent"}</span>
        </button>
        <p className="hint">You get a concept and a scene-by-scene plan to review. Nothing is made until you press Build.</p>
      </section>
    </>
  );

  const adReview = adPlan && (
    <div className="guided ad-review" aria-label="Your ad plan">
      <div className="guided-head">
        <h1>
          {adPlan.title}
        </h1>
        <p className="muted ad-concept">{adPlan.concept}</p>
        <button className="link-btn" onClick={() => setAdPlan(null)}>
          ← Back to the brief
        </button>
      </div>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">✓</span>
          <h2>Review your plan</h2>
          <span className="step-opt">change anything, nothing is made yet</span>
        </div>
        <label className="sub-label" htmlFor="ad-look">
          Keep the same in every scene
        </label>
        <textarea id="ad-look" className="prompt ad-field" rows={2} maxLength={400} value={adPlan.look} onChange={(e) => editPlan({ look: e.target.value })} />

        <ol className="ad-scenes">
          {adPlan.scenes.map((sc, i) => (
            <li key={i} className="ad-scene">
              <div className="ad-scene-head">
                <strong>Scene {i + 1}</strong>
                <span className="muted small">
                  {i * SCENE_SECONDS}–{(i + 1) * SCENE_SECONDS}s
                </span>
              </div>
              <label className="ad-label">
                What we see
                <textarea className="prompt ad-field" rows={3} maxLength={500} value={sc.visual} onChange={(e) => editScene(i, { visual: e.target.value })} />
              </label>
              <div className="ad-row">
                <label className="ad-label">
                  Camera
                  <input className="text-input" maxLength={120} value={sc.camera} onChange={(e) => editScene(i, { camera: e.target.value })} />
                </label>
                <label className="ad-label">
                  On-screen words
                  <input className="text-input" maxLength={60} value={sc.text} onChange={(e) => editScene(i, { text: e.target.value })} />
                </label>
              </div>
              <label className="ad-label">
                🎙️ Voiceover{" "}
                <span className={sc.voice.split(/\s+/).filter(Boolean).length > maxVoiceWords(SCENE_SECONDS) ? "error-text" : "muted"}>
                  ({sc.voice.split(/\s+/).filter(Boolean).length}/{maxVoiceWords(SCENE_SECONDS)} words)
                </span>
                <input className="text-input" maxLength={200} value={sc.voice} onChange={(e) => editScene(i, { voice: e.target.value })} />
              </label>
            </li>
          ))}
          <li className="ad-scene ad-card">
            <div className="ad-scene-head">
              <strong>End card</strong>
              <span className="muted small">
                {adPlan.scenes.length * SCENE_SECONDS}–{adPlan.seconds}s
              </span>
            </div>
            <div className="ad-row">
              <label className="ad-label">
                Headline
                <input className="text-input" maxLength={40} value={adPlan.endCard.headline} onChange={(e) => editPlan({ endCard: { ...adPlan.endCard, headline: e.target.value } })} />
              </label>
              <label className="ad-label">
                Call to action
                <input className="text-input" maxLength={60} value={adPlan.endCard.tagline} onChange={(e) => editPlan({ endCard: { ...adPlan.endCard, tagline: e.target.value } })} />
              </label>
            </div>
            <label className="ad-label">
              🎙️ Voiceover
              <input className="text-input" maxLength={160} value={adPlan.endCard.voice} onChange={(e) => editPlan({ endCard: { ...adPlan.endCard, voice: e.target.value } })} />
            </label>
          </li>
        </ol>

        <div className="ad-row">
          <label className="ad-label">
            🎵 Music
            <input className="text-input" maxLength={200} value={adPlan.music} onChange={(e) => editPlan({ music: e.target.value })} />
          </label>
          <label className="ad-label">
            🎙️ Voice
            <select className="text-input" value={adPlan.voice} onChange={(e) => editPlan({ voice: e.target.value })}>
              {AD_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">✎</span>
          <h2>Or ask for changes</h2>
        </div>
        <div className="chat-input">
          <textarea
            rows={2}
            maxLength={600}
            aria-label="Ask for changes to the plan"
            placeholder='e.g. "Make scene 1 funnier" or "Set it at the beach at sunset"'
            value={adAsk}
            onChange={(e) => setAdAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && adAsk.trim()) {
                e.preventDefault();
                planAd(adAsk.trim());
              }
            }}
          />
          <button className="chat-send" disabled={!adAsk.trim() || !!adBusy} onClick={() => planAd(adAsk.trim())} aria-label="Update the plan">
            ↑
          </button>
        </div>
        {adBusy && <p className="hint">{adBusy}</p>}
        {adError && <p className="error">{adError}</p>}
      </section>

      <section className="g-step g-go">
        <button className="generate" onClick={buildPlannedAd} disabled={mode === "locked" || !!adBusy}>
          <span className="generate-label">🎬 Build my {adPlan.seconds}-second ad</span>
          <span className="generate-cost">{mode === "demo" ? "Free" : `est. ${formatCost(adCost(adPlan, refs.length > 0))}`}</span>
        </button>
        <p className="hint">
          Makes every scene{refs.length ? " with your product" : ""}, the end card, the voiceover and the music, and gives you one finished video. Takes about{" "}
          {Math.round(3 + adPlan.scenes.length * 1.6)} minutes. {mode === "demo" ? `Free in demo mode (live estimate ${formatCost(adCost(adPlan, refs.length > 0))}).` : ""} {COST_NOTE}
        </p>
      </section>
    </div>
  );

  // ---------- Create, step by step in the middle of the page ----------

  const guided = (
    <div className="guided" aria-label="Create">
      <div className="guided-head">
        <h1>
          Make something <em>new</em>
        </h1>
        <p className="muted">Four quick steps. Everything already has a good default, so you can go straight to Generate.</p>
        {selected && (
          <button className="link-btn" onClick={() => setComposing(false)}>
            ← Back to your last result
          </button>
        )}
      </div>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">1</span>
          <h2>What are you making?</h2>
        </div>
        <div className="tabs tabs-3" role="tablist">
          {(["image", "video"] as MediaKind[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={!adMode && kind === k}
              className={!adMode && kind === k ? "tab active" : "tab"}
              onClick={() => {
                setAdMode(false);
                switchKind(k);
              }}
            >
              <span className="tab-icon" aria-hidden>
                {k === "image" ? <IconImage /> : <IconVideo />}
              </span>
              {k === "image" ? "Image" : "Video clip"}
            </button>
          ))}
          <button role="tab" aria-selected={adMode} className={adMode ? "tab active" : "tab"} onClick={() => setAdMode(true)}>
            <span className="tab-icon" aria-hidden>
              🎬
            </span>
            Full ad <span className="tag tag-rec">New</span>
          </button>
        </div>
        {adMode && (
          <p className="muted small g-hint">
            A finished ad with several scenes, a voiceover and music. You see the whole plan and can change it before anything is made.
          </p>
        )}
      </section>

      {adMode ? (
        adBrief
      ) : (
      <>
      <section className="g-step">
        <div className="g-head">
          <span className="g-num">2</span>
          <h2>{template ? `${template.emoji} ${template.name}: fill in the blanks` : `Describe your ${kind}`}</h2>
        </div>
        {template ? (
          <>
            {templateFields}
            <label className="sub-label" htmlFor="prompt">
              Your prompt (edit freely)
            </label>
            {describeBlock}
          </>
        ) : (
          <>
            {describeBlock}
            <div className="g-or">
              <span>or start from a template</span>
            </div>
            <div className="templates g-templates" id="templates">
              {kindTemplates.map(templateCard)}
            </div>
          </>
        )}
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">3</span>
          <h2>Options</h2>
          <span className="step-opt">already set, change if you like</span>
        </div>
        {settingsBlock}
        {modelSummary}
      </section>

      <section className="g-step g-go">
        <div className="g-head">
          <span className="g-num">4</span>
          <h2>Generate</h2>
        </div>
        {generateBar}
      </section>
      </>
      )}
    </div>
  );

  // ---------- after something is made: tweak settings and chat on the right ----------

  const sideSettings = (
    <details className="side-settings">
      <summary>✏️ Prompt and settings for a new {kind}</summary>
      {kindTabs}
      <label className="sub-label" htmlFor="prompt">
        Describe your {kind}
      </label>
      {describeBlock}
      {template && templateFields}
      {settingsBlock}
      {modelSummary}
      {generateBar}
    </details>
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
        {selected.story && selected.status !== "done" && (
          <StoryPanel item={selected} running={storyRuns.current.has(selected.id)} onResume={runStory} />
        )}
        {selected.ad && selected.status !== "done" && (
          <StoryPanel item={selected} running={adRuns.current.has(selected.id)} onResume={runAd} />
        )}
        {selected.ad && <AdSummary job={selected.ad} />}
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
      <p className="muted">Describe what you want or pick a template, then press Generate.</p>
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
              value={isAuto ? "auto:draft" : choice}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("auto:")) {
                  setChoice(AUTO);
                  setQuality(v.slice(5) as Quality);
                } else setChoice(v);
              }}
            >
              <option value="auto:draft">✦ Auto</option>
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
            <button
              className="link"
              onClick={() => {
                setComposing(true);
                go("create");
              }}
            >
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

  const createView =
    composing || !selected ? (
      adMode && adReview ? (
        adReview
      ) : (
        guided
      )
    ) : (
      <div className="workspace">
        <div className="workspace-main">{stage}</div>
        <div className="workspace-side">
          <section className="panel side-panel" aria-label="Chat about this result">
            <div className="side-top">
              <strong>Keep going</strong>
              <button className="btn" onClick={newCreation}>
                ＋ New
              </button>
            </div>
            {sideSettings}
            {chatPanel}
          </section>
        </div>
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
          onClick={newCreation}
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
  if (it.story) return (getModel(it.jobModelId ?? it.modelId)?.typicalSeconds ?? 100) + 10;
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
  if (item.ad) {
    const job = item.ad;
    const n = job.clips.length;
    const steps = n + 4;
    const finished =
      job.clips.filter((c) => c.url).length + (job.cardClip ? 1 : 0) + (job.joinedUrl ? 1 : 0) + (job.musicUrl ? 1 : 0);
    const view = progressView({
      phase: "working",
      elapsedSec: (now - (item.stepStartedAt ?? now)) / 1000,
      typicalSec: 90,
      step: Math.min(steps, finished + 1),
      steps,
      stepLabel: job.step ?? "Making your ad",
    });
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
  if (item.story) {
    const n = item.story.shots.length;
    const done = item.story.shots.filter((x) => x.status === "done").length;
    const steps = n + 1 + (item.story.sound ? 1 : 0);
    const finished = done + (item.story.joinedUrl ? 1 : 0);
    const view = progressView({
      phase: "working",
      elapsedSec: (now - (item.stepStartedAt ?? now)) / 1000,
      typicalSec: typicalSeconds(item),
      step: Math.min(steps, finished + 1),
      steps,
      stepLabel: item.story.step ?? "Making your shots",
    });
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
  const silentNeedsSound = item.kind === "video" && item.wantSound && !getModel(item.modelId)?.audio;
  const steps = silentNeedsSound ? 2 : 1;
  const step = item.stage === "sound" && steps === 2 ? 2 : 1;
  const what = item.kind;
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

type FixMode = "edit" | "remake";

/** Camera, angle and layout changes need a fresh picture; small changes can be edited in place. */
function suggestFixMode(note: string): FixMode {
  return /\b(angle|camera|view|viewpoint|perspective|shot from|from the (side|back|front|top|left|right|other)|side of|behind|overhead|facing|faces|face (the|away|towards?)|turn(ed)? around|looking at|layout|position|where|wide shot|close.?up|zoom|realistic|wouldn'?t|couldn'?t|can'?t see|other side|opposite|rearrange|move (the|him|her|them)|swap)\b/i.test(
    note,
  )
    ? "remake"
    : "edit";
}

/** Asks the vision model to look for mistakes in a finished picture or video (about 1 cent per 5 seconds). */
async function analyzeItem(item: Item): Promise<Analysis> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: item.kind, url: item.url, prompt: basePrompt(item) }),
  });
  let data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't check this.");
  const started = Date.now();
  while (data.status !== "COMPLETED") {
    if (data.status === "FAILED") throw new Error(data.error ?? "The check failed.");
    if (Date.now() - started > 3 * 60 * 1000) throw new Error("The check took too long. Try again.");
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`/api/analyze?kind=${item.kind}&requestId=${encodeURIComponent(data.requestId)}`);
    const next = await r.json().catch(() => ({}));
    data = { ...next, requestId: data.requestId };
  }
  return data.analysis as Analysis;
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
    if (!thumb) return <PlayOnce key={item.url} src={item.url!} />;
    return (
      <video
        src={item.url}
        muted
        playsInline
        onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
        onMouseLeave={(e) => e.currentTarget.pause()}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={item.url} alt={item.prompt} />;
}

/** Finished videos play once and stop, with a replay button. */
function PlayOnce({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  return (
    <>
      <video ref={ref} src={src} autoPlay playsInline controls onEnded={() => setEnded(true)} onPlay={() => setEnded(false)} />
      {ended && (
        <button
          className="replay"
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            v.currentTime = 0;
            v.play().catch(() => {});
          }}
        >
          ↻ Replay
        </button>
      )}
    </>
  );
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
    return "This sounds like several moments. A 5 to 10 second clip can show about one, so we'll focus on the main moment, or pick a longer length to fit them all.";
  }
  return null;
}

/** The ad's plan under the video, so people can say "scene 2: ..." in the chat. */
function AdSummary({ job }: { job: AdJob }) {
  return (
    <details className="enhanced-peek ad-summary">
      <summary>🎬 The plan this ad was made from</summary>
      <ol>
        {job.plan.scenes.map((s, i) => (
          <li key={i}>
            <strong>Scene {i + 1}.</strong> {s.visual} <span className="muted">🎙️ {s.voice}</span>
          </li>
        ))}
        <li>
          <strong>End card.</strong> {job.plan.endCard.headline}
          {job.plan.endCard.tagline ? `, ${job.plan.endCard.tagline}` : ""} <span className="muted">🎙️ {job.plan.endCard.voice}</span>
        </li>
      </ol>
      <p className="muted small">Music: {job.plan.music}</p>
    </details>
  );
}

function StoryPanel({ item, running, onResume }: { item: Item; running: boolean; onResume: (it: Item) => void }) {
  if (item.status === "failed")
    return (
      <div className="final-box">
        <button className="generate small" onClick={() => onResume(item)}>
          Try again
        </button>
        <p className="hint">Carries on from where it stopped. Parts that already finished aren&apos;t paid for again.</p>
      </div>
    );
  if (item.status === "pending" && !running)
    return (
      <div className="final-box">
        <button className="generate small" onClick={() => onResume(item)}>
          Continue making this video
        </button>
      </div>
    );
  return null;
}
