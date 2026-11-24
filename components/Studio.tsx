"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADD_SOUND_MODEL, animateModelFor, costRange, EDIT_IMAGE_MODEL, estimateCost, HD_IMAGE_MODEL, HD_VIDEO_MODEL, hdScaleFor, KEYFRAME_MODEL_ID, REFERENCE_IMAGE_MODEL, formatCost, COST_NOTE, getModel, MODELS, type AspectRatio, type MediaKind } from "@/lib/models";
import { allClearlyWrong, extraCost, isNewImage, isTextToVideo, jobCost, pickBest, takesFor } from "@/lib/quality";
import { autoAspectRatios, pickModel, type Quality } from "@/lib/router";
import { brandValues, coverCrop, fillTemplate, sizeLabel, TEMPLATE_CATEGORIES, templateByName, templatesIn, TEMPLATES, type Template, type TemplateCategory, type TemplateSize } from "@/lib/templates";
import type { AppMode } from "@/lib/config";
import { INSPIRATION, TEMPLATE_MEDIA, type ShowcaseMedia } from "@/lib/showcase";
import { checkPrompt } from "@/lib/safety";
import AgreeModal, { hasAcceptedTerms } from "./AgreeModal";
import Link from "next/link";
import { progressView, type Phase } from "@/lib/progress";
import ReferencesBox, { finishReference, loadRefs, saveRefs, type RefItem } from "./ReferencesBox";
import { loadEleven, type ElevenConnection } from "./elevenConnect";
import { OwnVoiceOptions } from "./VoiceOptions";
import { isOwnVoice } from "@/lib/elevenlabs";
import BrandKit, { brandInfo, hasBrand, KIT_PICTURES, loadBrand, saveBrand, type Brand } from "./BrandKit";
import { brandLine, colorName } from "@/lib/brand";
import type { Direction, DirectorReply } from "@/lib/director";
import type { Idea } from "@/lib/ideas";
import { AdaptBox, IdeasBox } from "./IdeaHelpers";
import { describesSeveralShots, firstShot } from "@/lib/shots";
import { guessKind } from "@/lib/kind";
import VoiceButton, { joinSpoken } from "./VoiceButton";
import { addSoundTo, animateShot, joinShots, lastFrame, lockFrame, planStory, startPicture, waitFor, type Story } from "./storyRunner";
import { lengthAdvice, LONG_LENGTHS, MAX_STORY_SECONDS, type ShotPlan } from "@/lib/storyboard";
import { nextLength, readChat } from "@/lib/chat";
import { AD_LANGUAGES, AD_LENGTHS, AD_PRICES, AD_TONES, AD_VOICES, adCost, languageFromLocale, maxVoiceChars, checkCost, endCardSeconds, maxRedos, maxVoiceWords, redoCap, SCENE_SECONDS, sceneCount, sceneRemakeCost, type AdBrief, type AdPlan } from "@/lib/adplan";
import { AD_T2V, buildAd, changedAdJob, checkPart, newAdJob, type AdJob } from "./adRunner";
import { ADVERTISE_PROMISE, asksForSpeech, decide, MONTHLY_CAP, promiseNote, type PromiseOutcome } from "@/lib/promise";
import type { Analysis } from "@/lib/analyze";
import { creditsFor } from "@/lib/pricing";
import { logFreeRemake, logReturned, logUsed, usedThisMonth } from "./creditLog";

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
  takes?: Takes; // behind the scenes: checked first-frame pictures for a video, or two takes of a premium picture
  scale?: number; // "Sharpen to HD": how much bigger the video gets
  creditUsd?: number; // what an ad version costs to make, worked out when it starts
  charged?: boolean; // its credits were counted (only once it finished, so failed jobs never use any)
  free?: boolean; // a remake given under the no wasted credits promise
  promiseCheck?: "running" | "done"; // the automatic check for clear faults
  promise?: { type: PromiseOutcome["type"]; note: string }; // what the promise did for this result
};

/** Something the chat offers to do, always shown with its price first. */
type ChatAct =
  | { type: "fix"; note: string; how: FixMode; newPrompt?: string }
  | { type: "length"; seconds: number }
  | { type: "final" }
  | { type: "sound" }
  | { type: "video" }
  | { type: "hd" }
  | { type: "ad"; plan: AdPlan; note: string }
  | { type: "shape"; aspectRatio: AspectRatio };
type ChatOffer = { label: string; cost: number; act: ChatAct; free?: boolean };
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

/**
 * Work done before the result, behind the scenes. Videos: the first frame is made
 * as a picture and checked before any video is paid for, then animated. Premium
 * jobs make two takes and the checker keeps the better one.
 */
type Takes = {
  count: number;
  urls?: string[];
  best?: string; // the take that was kept
  bestIndex?: number;
  redone?: boolean; // every take was clearly wrong, so one more was made with the fix
  step?: string; // plain words for the progress label
  animateModelId?: string; // video: the model that brings the picture to life
};

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
  const key = videoModelId.includes("hailuo") || videoModelId.includes("minimax") ? "hailuo" : videoModelId.includes("kling/v4") ? "kling/v4" : "kling-video";
  const shot = animateModelFor(key);
  const first = MODELS.find((m) => m.kind === "video" && m.id.includes(key) && !m.takesImage) ?? shot;
  return { shot, first, seconds: shot.durations?.[0] ?? 5 };
}
function storyCost(videoModelId: string, shots: number, sound: boolean, withRefs = false): number {
  const { shot, seconds } = storyModels(videoModelId);
  return (
    shots * estimateCost(shot, seconds, false) +
    (sound ? estimateCost(ADD_SOUND_MODEL, shots * seconds, true) : 0) +
    // With your own pictures: the opening picture, then one product check-and-correct before each later shot.
    (withRefs ? shots * estimateCost(REFERENCE_IMAGE_MODEL) : 0)
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
  scale?: number;
  hasAudio?: boolean; // the source already has sound (Sharpen to HD keeps it)
};

const AUTO = "auto";
// The brand kit's words are added after this mark, so "Reuse prompt" can take them off again.
const BRAND_MARK = "\n\nOn brand: ";
const SHAPE_USES: Record<string, string> = { "9:16": "TikTok, Reels and Shorts", "1:1": "the Instagram feed", "16:9": "YouTube and websites" };
type View = "home" | "create" | "templates" | "gallery" | "brand";
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
  const [tplCat, setTplCat] = useState<TemplateCategory | "all">("all");
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | MediaKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recreateAsk, setRecreateAsk] = useState<string | null>(null); // a result waiting for "yes" before an expensive new take
  const [view, setView] = useState<View>("home");
  const [formError, setFormError] = useState<string | null>(null);
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [refsSignal, setRefsSignal] = useState(0); // bumps when the Reference button is pressed
  const [homeRefsOpen, setHomeRefsOpen] = useState(false);
  const [kindPicked, setKindPicked] = useState(false); // the person chose Image or Video themselves
  const [kindWhy, setKindWhy] = useState<string | null>(null); // why the Home box chose Image or Video
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const promptNow = useRef("");
  promptNow.current = prompt;
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
  const [adCheck, setAdCheck] = useState(true); // check every scene and remake weak ones
  // Brand kit, saved in this browser and switched on per project.
  const [brand, setBrand] = useState<Brand>({ pictures: [] });
  const [eleven, setEleven] = useState<ElevenConnection | null>(null); // the user's own ElevenLabs voices, in this browser only
  const [useBrand, setUseBrand] = useState(true);
  // Start an ad from a product page.
  const [productLink, setProductLink] = useState("");
  const [productBusy, setProductBusy] = useState<string | null>(null);
  const [productPics, setProductPics] = useState<string[]>([]);
  const [productPicked, setProductPicked] = useState<string[]>([]);
  const [productConsent, setProductConsent] = useState(false);
  // The creative director: three directed ways to make the idea.
  const [director, setDirector] = useState<(DirectorReply & { idea: string; kind: MediaKind }) | null>(null);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [directorError, setDirectorError] = useState<string | null>(null);
  const [directorAnswers, setDirectorAnswers] = useState("");
  const [directorPicked, setDirectorPicked] = useState<number | null>(null);
  // Idea helpers: "Give me ideas", and "Make one like this for my brand" on examples and templates.
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [adaptFor, setAdaptFor] = useState<number | null>(null); // which example card is being made "mine"
  const [adaptTemplate, setAdaptTemplate] = useState(false);
  const polling = useRef(new Set<string>());
  const takeRuns = useRef(new Set<string>());
  const madeHere = useRef(new Set<string>()); // jobs started on this page visit, so old gallery items are never counted again
  const nextFree = useRef(false); // the next job is a free remake under the promise

  const isAuto = choice === AUTO;
  const brandOn = useBrand && hasBrand(brand);
  const kitPics = brandOn ? brand.pictures : undefined;
  const saveToKit = (r: RefItem) => setBrand((b) => ({ ...b, pictures: [...b.pictures.filter((x) => x.url !== r.url), r].slice(-KIT_PICTURES) }));
  const auto = pickModel({ kind, prompt, quality, aspectRatio });
  const model = isAuto ? auto.model : (getModel(choice) ?? models[0]);
  const shapes = isAuto ? autoAspectRatios(kind) : model.aspectRatios;
  // The length to use right now (the stored one can lag a render behind a model change).
  const length = model.durations ? (model.durations.includes(duration ?? -1) ? duration : model.durations[0]) : undefined;
  // Prices include the checked first picture of a video, and the second take on premium jobs.
  const cost = jobCost(model, length, kind === "video" && sound);
  const costWith = jobCost(model, length, true);
  const costWithout = jobCost(model, length, false);
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
    setBrand(loadBrand());
    setEleven(loadEleven());
    // Voiceovers start in the browser's language (changeable in the ad's options).
    setBrief((b) => (b.language ? b : { ...b, language: languageFromLocale(navigator.language) }));
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
    if (loaded) saveBrand(brand);
  }, [brand, loaded]);
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
          scale: item.scale,
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
    items.filter((it) => it.status === "pending" && it.takes && !it.requestId && !it.story).forEach(runTakes);
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
      hasAudio: spec.hasAudio ?? Boolean(m.audio && wantSound),
      stage: "video",
      free: nextFree.current || undefined,
    };
    nextFree.current = false;
    madeHere.current.add(item.id);
    // Behind the scenes: a video made from words starts as a checked picture; premium pictures get two takes.
    const plain = !spec.sourceUrl && !spec.purpose && !spec.refs?.length;
    const takes = takesFor(m.id, spec.quality);
    if (plain && isTextToVideo(m)) item.takes = { count: takes, animateModelId: animateModelFor(m.id).id };
    else if (plain && isNewImage(m) && takes > 1) item.takes = { count: takes };
    setItems((prev) => [item, ...prev]);
    setSelectedId(item.id);
    setView("create");
    setComposing(false);
    if (item.takes) runTakes(item);
    else submitStep(item, spec.modelId, spec.sourceUrl);
  }

  /** Makes one picture for the takes step and waits for it. */
  async function makeTake(it: Item, modelId: string, prompt: string, video: boolean) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        prompt: video ? `${prompt}\nThis is the opening frame of the video: show the moment just before the main action.`.slice(0, 1990) : prompt,
        aspectRatio: it.aspectRatio,
        enhance: it.enhance !== false,
        purpose: video ? "keyframe" : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
    const url = await waitFor(data.modelId ?? modelId, data);
    return { url, demo: Boolean(data.demo), enhancedPrompt: data.enhancedPrompt as string | undefined, enhanceNote: data.enhanceNote as string | undefined };
  }

  /**
   * The takes step. Makes the pictures, lets the checker pick the best, and for a
   * video remakes the picture once if every take is clearly wrong, then animates
   * it. Safe to call again after the page was closed.
   */
  async function runTakes(start: Item) {
    if (!start.takes || takeRuns.current.has(start.id)) return;
    takeRuns.current.add(start.id);
    const t: Takes = { ...start.takes, urls: start.takes.urls ? [...start.takes.urls] : undefined };
    const save = (patch: Partial<Item> = {}) => update(start.id, { takes: { ...t, urls: t.urls ? [...t.urls] : undefined }, ...patch });
    const video = start.kind === "video";
    const picModel = video ? KEYFRAME_MODEL_ID : start.modelId;
    let info: { demo?: boolean; enhancedPrompt?: string; enhanceNote?: string } = {};
    try {
      if (!t.best) {
        if (!t.urls?.length) {
          t.step = video ? "Setting up the first shot" : `Making ${t.count} takes`;
          save({ status: "pending", stepStartedAt: Date.now(), phase: "working", jobModelId: picModel });
          const made = await Promise.allSettled(Array.from({ length: t.count }, () => makeTake(start, picModel, start.prompt, video)));
          const ok = made.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
          if (!ok.length) throw (made[0] as PromiseRejectedResult).reason;
          info = ok[0];
          t.urls = ok.map((x) => x.url);
          save();
        }
        const urls = t.urls!;
        t.step = urls.length > 1 ? "Picking the best take" : "Checking the shot";
        save({ stepStartedAt: Date.now(), jobModelId: "fal-ai/any-llm/vision" });
        const checks = await Promise.all(urls.map((u) => checkPart("image", u, basePrompt(start))));
        let i = pickBest(checks);
        if (video && !t.redone && allClearlyWrong(checks)) {
          // Every picture is clearly wrong: one more, with the checker's fix, before any video is paid for.
          t.redone = true;
          t.step = "Fixing the first shot";
          save({ stepStartedAt: Date.now(), jobModelId: picModel });
          try {
            const fix = (checks[i]?.fix || checks[i]?.problems.join(" ") || "").slice(0, 400);
            const again = await makeTake(start, picModel, `${start.prompt}\nImportant: ${fix}`, true);
            const c = await checkPart("image", again.url, basePrompt(start));
            urls.push(again.url);
            checks.push(c);
            i = pickBest(checks);
          } catch {
            // keep the best of what we have
          }
        }
        t.best = urls[i];
        t.bestIndex = i;
      }
      t.step = undefined;
      save();
    } catch (e) {
      t.step = undefined;
      if (!video) {
        save();
        fail(start, (e as Error).message || "Something went wrong.");
        takeRuns.current.delete(start.id);
        return;
      }
      // The picture step failed: make the video straight from the words instead.
      t.best = undefined;
      save();
      takeRuns.current.delete(start.id);
      submitStep({ ...start, takes: t }, start.modelId);
      return;
    }
    takeRuns.current.delete(start.id);
    const next: Item = { ...start, takes: t, enhancedPrompt: info.enhancedPrompt ?? start.enhancedPrompt, enhanceNote: info.enhanceNote ?? start.enhanceNote };
    if (!video) return stepDone(next, t.best!, info.demo);
    // Animate the picture that was kept. The video model gets the user's words, not the picture's.
    submitStep({ ...next, purpose: "animate" }, t.animateModelId ?? animateModelFor(start.modelId).id, t.best);
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
    const typed = prompt.trim();
    const kitLine = brandOn ? brandLine(brandInfo(brand)) : "";
    const text = kitLine && typed ? `${typed}${BRAND_MARK}${kitLine}.`.slice(0, 2000) : typed;
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
      free: nextFree.current || undefined,
    };
    nextFree.current = false;
    madeHere.current.add(item.id);
    setItems((prev) => [item, ...prev]);
    setSelectedId(item.id);
    setView("create");
    setComposing(false);
    runStory(item);
  }

  // ---------- Creative director ----------

  async function callDirector(idea: string, k: MediaKind, answers = ""): Promise<DirectorReply> {
    const res = await fetch("/api/director", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, kind: k, answers, brand: brandOn ? brandInfo(brand) : undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.directions)) throw new Error(data.error ?? "The director is busy. Please try again.");
    return data as DirectorReply;
  }

  /** Asks the director for three ways to make what's in the prompt box (or the idea it started from). */
  async function askDirector(withAnswers = false) {
    const idea = withAnswers && director ? director.idea : prompt.trim();
    setDirectorError(null);
    if (!idea) {
      setDirectorError("Write your idea first, even a few words.");
      return;
    }
    setDirectorBusy(true);
    try {
      const reply = await callDirector(idea, kind, withAnswers ? directorAnswers.trim() : "");
      setDirector({ ...reply, idea, kind });
      setDirectorPicked(null);
      if (!withAnswers) setDirectorAnswers("");
    } catch (e) {
      setDirectorError((e as Error).message);
    } finally {
      setDirectorBusy(false);
    }
  }

  /** Puts a direction into the form: its prompt, and its shape and length when they fit. */
  function applyDirection(d: Direction, i: number) {
    setPrompt(d.prompt);
    setDirectorPicked(i);
    if (shapes.includes(d.shape)) setAspectRatio(d.shape);
    if (kind === "video" && d.seconds) {
      if (d.seconds <= 10) {
        setStoryLen(null);
        const ds = model.durations ?? [];
        if (ds.length) setDuration(ds.reduce((a, b) => (Math.abs(b - d.seconds) < Math.abs(a - d.seconds) ? b : a)));
      } else setStoryLen(LONG_LENGTHS.reduce((a, b) => (Math.abs(b - d.seconds) < Math.abs(a - d.seconds) ? b : a)));
    }
  }

  /** In the chat: the director watches a finished video and offers directed remakes. */
  async function directorNotes(it: Item, thread: string) {
    const id = say(thread, it.id, { text: "Thinking about how a director would shoot this...", state: "working" });
    try {
      const reply = await callDirector(basePrompt(it), it.kind);
      patchMsg(id, { state: "done", text: `${reply.read || "Here's how I'd direct it."} Three ways I'd shoot it again (same shape and length):` });
      const cost = fixCost(it, "remake");
      say(thread, it.id, {
        text: reply.directions.map((d, i) => `${i + 1}. ${d.name}: ${d.why}`).join("\n"),
        offers: reply.directions.map((d) => ({ label: `🎬 ${d.name}`, cost, act: { type: "fix" as const, note: `Directed as "${d.name}"`, how: "remake" as const, newPrompt: d.prompt } })),
        state: "open",
      });
    } catch (e) {
      patchMsg(id, { state: "done", text: (e as Error).message });
    }
  }

  // ---------- Full ad ----------

  /** The brief as sent to the planner: with the kinds of pictures given and, when it's on, the brand kit. */
  function adBriefNow(): AdBrief {
    return { ...brief, refKinds: refs.map((r) => r.kind), brand: brandOn ? brandInfo(brand) : undefined };
  }

  /** Reads the user's product page: fills in the brief and offers its pictures (free, no AI). */
  async function readProductLink() {
    setAdError(null);
    setProductBusy("Reading the page...");
    setProductPics([]);
    setProductPicked([]);
    try {
      const res = await fetch("/api/product", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: productLink.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That page couldn't be read.");
      setBrief((b) => ({ ...b, product: data.brief }));
      const pics = (data.product?.images ?? []) as string[];
      setProductPics(pics);
      setProductPicked(pics.slice(0, 1));
    } catch (e) {
      setAdError((e as Error).message);
    } finally {
      setProductBusy(null);
    }
  }

  /** Brings the chosen product page pictures in as product references, each one checked first. */
  async function useProductPics() {
    setAdError(null);
    const room = 4 - refs.length;
    const pick = productPicked.filter((u) => !refs.some((r) => r.name === u)).slice(0, Math.max(0, room));
    if (!pick.length) {
      setAdError(room <= 0 ? "You already have 4 pictures. Remove one first." : "Pick a picture first.");
      return;
    }
    const added: RefItem[] = [];
    try {
      for (let i = 0; i < pick.length; i++) {
        setProductBusy(`Checking picture ${i + 1} of ${pick.length}...`);
        const res = await fetch("/api/reference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: pick[i], kind: "product", consent: "yes" }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "We couldn't use that picture.");
        const done = await finishReference(data, "product");
        added.push({ url: done.url, token: done.token, kind: "product", name: pick[i] });
      }
      setProductPics([]);
    } catch (e) {
      setAdError((e as Error).message);
    } finally {
      if (added.length) setRefs((r) => [...r, ...added].slice(0, 4));
      setProductBusy(null);
    }
  }

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
        body: JSON.stringify({ brief: adBriefNow(), plan: request ? adPlan : undefined, request }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.plan) throw new Error(data.error ?? "Couldn't plan the ad. Please try again.");
      const next = data.plan as AdPlan;
      if (brandOn && brand.voice && !request) next.voice = brand.voice;
      setAdPlan(next);
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
      creditUsd: adStartCost(job, opts.parentId),
    };
    madeHere.current.add(item.id);
    setItems((prev) => [item, ...prev]);
    setSelectedId(item.id);
    setView("create");
    setComposing(false);
    runAd(item);
  }

  function buildPlannedAd() {
    if (!adPlan) return;
    const useRefs = refs.map(({ url, kind, token }) => ({ url, kind, token }));
    startAd(newAdJob(adBriefNow(), adPlan, useRefs, adCheck), { aspectRatio: adShape });
  }

  /** Makes every missing part of an ad, then joins and mixes. Safe to call again to resume. */
  async function runAd(start: Item) {
    if (!start.ad || adRuns.current.has(start.id)) return;
    adRuns.current.add(start.id);
    const job: AdJob = JSON.parse(JSON.stringify(start.ad));
    const save = (j: AdJob, patch: Partial<Item> = {}) => update(start.id, { ad: JSON.parse(JSON.stringify(j)), ...patch });
    try {
      update(start.id, { status: "pending", error: undefined, stepStartedAt: Date.now(), phase: "working" });
      const out = await buildAd(job, start.aspectRatio, save, { live: mode === "live" });
      job.step = undefined;
      save(job, { status: "done", url: out.url, hasAudio: out.hasAudio, stage: "sound" });
    } catch (e) {
      job.step = undefined;
      save(job, { status: "failed", error: (e as Error).message || "A scene failed." });
    } finally {
      adRuns.current.delete(start.id);
    }
  }

  /** What an ad costs to make: all of it for a new ad, only the changed parts for a new version. */
  function adStartCost(job: AdJob, parentId?: string): number {
    const parent = parentId ? items.find((x) => x.id === parentId)?.ad : undefined;
    const fresh = job.clips.filter((c) => !c.url).length;
    if (!parent || fresh === job.clips.length) return adCost(job.plan, Boolean(job.refs?.length), Boolean(job.check?.on));
    return adChangeCost(parent, job.plan);
  }

  /** What a finished job cost to make, for counting its credits. */
  function itemCost(it: Item): number {
    if (it.ad) return it.creditUsd ?? adCost(it.ad.plan, Boolean(it.ad.refs?.length), Boolean(it.ad.check?.on));
    if (it.story) return storyCost(it.story.firstModelId, Math.max(1, it.story.shots.length || it.story.wantShots || 1), it.story.sound, Boolean(it.story.refs?.length));
    const m = getModel(it.modelId);
    return m ? jobCost(m, it.duration, Boolean(it.wantSound), it.quality) : 0;
  }

  // The no wasted credits promise. A job's credits are only counted once it has
  // finished, so a failed job never uses any. Finished videos get an automatic
  // check for clear faults, behind the scenes.
  useEffect(() => {
    if (!loaded) return;
    for (const it of items) {
      if (!madeHere.current.has(it.id)) continue;
      if (it.status === "done" && !it.charged) {
        if (!it.free && mode === "live") logUsed(it.id, creditsFor(itemCost(it)), it.modelName);
        const check = mode === "live" && it.kind === "video" && Boolean(it.url) && !it.ad && !it.demo;
        update(it.id, { charged: true, promise: undefined, promiseCheck: check ? "running" : undefined });
        if (check) autoCheck(it);
        if (it.ad?.check?.faultsLeft?.length) adPromise(it);
      } else if (it.status === "failed" && !it.promise) {
        update(it.id, {
          promise: {
            type: "refund",
            note: it.ad || it.story
              ? "It stopped partway, so it uses no credits. Carrying on finishes it without paying again for the parts already made."
              : promiseNote(decide({ failed: true, usedThisMonth: 0 }))!,
          },
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loaded]);

  /** Looks at a finished video (and listens, when nobody asked for speech) for the clear faults the promise covers. */
  async function autoCheck(it: Item) {
    const wantsSpeech = asksForSpeech(basePrompt(it));
    const [a, speech] = await Promise.all([analyzeItem(it).catch(() => null), it.hasAudio && !wantsSpeech ? speechCheck(it.url!) : Promise.resolve(false)]);
    applyPromise(it, withSpeech(a, speech), rootOf(it.id), true);
  }

  /**
   * Acts on a check's result: credits back for a clear fault, a free remake for a
   * borderline problem, within the monthly limit. Returns false when the promise
   * had nothing to do, so the normal "Find what's wrong" reply can be shown.
   */
  function applyPromise(it: Item, a: Analysis | null, thread: string, auto = false): boolean {
    let outcome = decide({ check: a, usedThisMonth: usedThisMonth() });
    // Never two free remakes in a row for the same idea.
    if (outcome.type === "free_remake" && it.free) outcome = { type: "none" };
    if (outcome.type === "refund" && !logReturned(it.id, outcome.fault, outcome.reason)) outcome = { type: "none" };
    const note = promiseNote(outcome);
    update(it.id, auto ? { promiseCheck: "done", ...(note ? { promise: { type: outcome.type, note } } : {}) } : note ? { promise: { type: outcome.type, note } } : {});
    if (!note || !a) return false;
    const fixNote = it.kind === "image" && a.fix ? a.fix : a.problems.join(" ");
    const how: FixMode = it.kind === "image" ? suggestFixMode(fixNote) : "edit";
    const fix: ChatAct = { type: "fix", note: fixNote, how, newPrompt: it.kind === "video" ? a.prompt || undefined : undefined };
    say(thread, it.id, {
      text: note,
      problems: a.problems,
      offers: it.ad
        ? undefined
        : [outcome.type === "free_remake" ? { label: "🔧 Remake it on us", cost: 0, free: true, act: fix } : { label: "🔧 Remake it, fixed", cost: fixCost(it, how), act: fix }],
      state: it.ad ? undefined : "open",
    });
    return true;
  }

  /** An ad scene still had a clear fault after the automatic remakes: that scene's credits come back. */
  function adPromise(it: Item) {
    const left = it.ad?.check?.faultsLeft ?? [];
    if (!left.length || !it.ad) return;
    const scenes = left.map((f) => f.scene + 1).join(" and ");
    if (usedThisMonth() >= MONTHLY_CAP) {
      update(it.id, { promise: { type: "capped", note: `Our check found a clear fault in scene ${scenes}. This month's ${MONTHLY_CAP} automatic refunds and free remakes are used up, so it's charged as normal.` } });
      return;
    }
    const credits = left.length * creditsFor(sceneRemakeCost(it.ad.plan, Boolean(it.ad.refs?.length)));
    if (!logReturned(it.id, left[0].fault, `Scene ${scenes}: ${left[0].reason}`, credits)) return;
    update(it.id, {
      promise: { type: "refund", note: `Our check found a clear fault in scene ${scenes} (${left[0].reason.toLowerCase()}). Under our no wasted credits promise, the credits for ${left.length > 1 ? "those scenes" : "that scene"} come back.` },
    });
  }

  /** Price of a new version after a plan change: only changed parts are made again. */
  function adChangeCost(old: AdJob, plan: AdPlan): number {
    const c = changedAdJob(old, plan);
    const withRefs = Boolean(old.refs?.length);
    return (
      c.scenes * (AD_PRICES.scene + AD_PRICES.picture) +
      (c.card ? AD_PRICES.picture + endCardSeconds(plan.seconds) * AD_PRICES.cardPerSecond : 0) +
      (!withRefs && old.plan.look !== plan.look ? AD_PRICES.picture : 0) +
      (isOwnVoice(plan.voice) ? 0 : (c.voiceChars / 1000) * AD_PRICES.voicePer1000Chars) +
      (c.music ? AD_PRICES.musicPerMinute * Math.ceil(plan.seconds / 60) : 0) +
      plan.seconds * AD_PRICES.editPerSecond * 2
    );
  }

  /** The same ad in another shape: new pictures and scenes, the voiceover and music are reused. */
  function shapeCost(job: AdJob): number {
    const n = job.plan.scenes.length;
    return (
      n * (AD_PRICES.scene + AD_PRICES.picture) +
      AD_PRICES.picture +
      endCardSeconds(job.plan.seconds) * AD_PRICES.cardPerSecond +
      job.plan.seconds * AD_PRICES.editPerSecond * 2 +
      (job.check?.on ? checkCost(n) : 0)
    );
  }
  function makeShape(it: Item, aspectRatio: AspectRatio) {
    const old = it.ad!;
    const job: AdJob = {
      ...newAdJob(old.brief, old.plan, old.refs, Boolean(old.check?.on)),
      voices: [...old.voices],
      voiceFor: [...old.voiceFor],
      musicUrl: old.musicUrl,
      musicFor: old.musicFor,
      productUrl: old.productUrl,
      productToken: old.productToken,
    };
    startAd(job, { parentId: it.id, fixNote: `${SHAPE_USES[aspectRatio] ?? aspectRatio} version`, aspectRatio });
  }
  function offerShapes(it: Item, thread: string) {
    const cost = shapeCost(it.ad!);
    const others = (["9:16", "1:1", "16:9"] as AspectRatio[]).filter((ar) => ar !== it.aspectRatio);
    say(thread, it.id, {
      text: `I'll make the same ad in another shape, with the same plan, voiceover and music. Only the pictures and scenes are made again, so each shape costs ${price(cost)}.`,
      offers: others.map((ar) => ({ label: `📐 ${ar} for ${SHAPE_USES[ar]}`, cost, act: { type: "shape" as const, aspectRatio: ar } })),
      state: "open",
    });
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
          // Lock the product: the starting frame is checked against the user's own pictures first.
          if (i > 0 && story.refs?.length && !story.shots[i - 1].lockedFrame) {
            story.step = `Shot ${i + 1} of ${n}: keeping your product the same`;
            save({ stepStartedAt: Date.now(), jobModelId: REFERENCE_IMAGE_MODEL.id });
            await lockFrame(story, i, start.aspectRatio);
            story.step = `Shot ${i + 1} of ${n}`;
            save({ stepStartedAt: Date.now(), jobModelId: story.shotModelId });
          }
          shot.url = await animateShot(story, i, start.aspectRatio);
          // The next shot continues from this one's last frame.
          if (i < n - 1) {
            const f = await lastFrame(shot.url);
            shot.lastFrame = f.url;
            shot.lastFrameToken = f.token;
            shot.lockedFrame = undefined;
          }
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

  /** "Make this" on an idea: fills Create with it, ready for Generate. */
  function makeIdea(idea: Idea) {
    setAdMode(false);
    setTemplate(null);
    setFormError(null);
    setDirectorPicked(null);
    setKind(idea.kind);
    setChoice(AUTO);
    setAspectRatio(idea.shape);
    if (idea.kind === "video") {
      setStoryLen(null);
      setDuration(idea.seconds || 5);
    }
    setPrompt(idea.prompt);
    if (hasBrand(brand)) setUseBrand(true);
    setComposing(true);
    go("create");
    setTimeout(() => document.querySelector(".g-go")?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  }

  /** "Make one like this for my brand" on an example: Create opens with the rewritten prompt. */
  function makeAdapted(k: MediaKind, shape: AspectRatio, newPrompt: string) {
    setAdaptFor(null);
    makeIdea({ title: "", why: "", kind: k, shape: shape as Idea["shape"], seconds: 5, prompt: newPrompt });
  }

  function chooseTemplate(t: Template | null) {
    setAdaptTemplate(false);
    setTemplate(t);
    setFormError(null);
    if (!t) return;
    const start = brandValues(t, brand);
    setFields(start);
    setKind(t.kind);
    setAspectRatio(t.aspectRatio);
    setChoice(AUTO);
    setPrompt(fillTemplate(t, start));
    // Business templates put the logo from the brand kit on the design.
    const logo = t.category === "business" && brandOn ? brand.pictures.find((r) => r.kind === "logo") : undefined;
    if (logo) setRefs((r) => (r.some((x) => x.url === logo.url) ? r : [...r, logo].slice(-4)));
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
  const kindTemplates = templatesIn(tplCat).filter((t) => t.kind === kind);
  const selected = items.find((it) => it.id === selectedId) ?? items[0] ?? null;
  const recent = items.slice(0, 12);
  const selSize = selected ? sizedFor(selected) : undefined; // a picture made for an exact size (Teams background...)

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
      setBrief({ product: it.ad.brief.product, audience: it.ad.brief.audience, seconds: it.ad.brief.seconds, tone: it.ad.brief.tone, language: it.ad.brief.language ?? "English" });
      setAdCheck(it.ad.check?.on ?? true);
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
    setPrompt(basePrompt(it).split(BRAND_MARK)[0]);
    setEnhance(it.enhance !== false);
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

  /** Opens the Create form with the improved prompt in the box, ready to change and generate. It isn't improved again. */
  function editEnhanced(it: Item) {
    if (!it.enhancedPrompt) return;
    reuse(it);
    setPrompt(it.enhancedPrompt.slice(0, 2000));
    setEnhance(false);
  }

  /** How many shots a linked-shot video was planned with. */
  function storyShotCount(it: Item): number {
    return Math.max(1, it.story?.wantShots || it.story?.shots.length || 1);
  }

  const m0 = (it: Item) => getModel(it.modelId);

  /** Estimated price of a new take of this result, or null if it can't be made again. */
  function recreateCost(it: Item): number | null {
    if (it.ad) return adCost(it.ad.plan, !!it.ad.refs?.length, !!it.ad.check?.on);
    if (it.story) return storyCost(it.story.firstModelId, storyShotCount(it), it.story.sound, !!it.story.refs?.length);
    const m = getModel(it.modelId);
    if (!m) return null;
    if (m.needsSource || m.takesImage) {
      if (!it.sourceUrl) return null; // the picture it was made from is gone
    }
    return jobCost(m, it.duration, it.kind === "video" && it.wantSound !== false, it.quality);
  }

  /** Makes a new take straight away, with the same prompt and settings. It joins the same history and chat. */
  function recreate(it: Item) {
    setRecreateAsk(null);
    if (it.ad) {
      const job = newAdJob(it.ad.brief, JSON.parse(JSON.stringify(it.ad.plan)) as AdPlan, it.ad.refs, !!it.ad.check?.on);
      startAd(job, { parentId: it.id, aspectRatio: it.aspectRatio });
      return;
    }
    if (it.story) {
      const n = storyShotCount(it);
      const planned = it.story.shots.map((s) => s.prompt).filter(Boolean);
      startStory(it.prompt, planned.length === n ? planned : [], n, {
        refs: it.story.refs as RefItem[] | undefined,
        templateName: it.templateName,
        parentId: it.id,
        fixNote: it.fixNote,
        videoModelId: it.story.firstModelId,
        sound: it.story.sound,
        aspectRatio: it.aspectRatio,
      });
      return;
    }
    runJob({
      kind: it.kind,
      modelId: it.modelId,
      prompt: it.prompt,
      aspectRatio: it.aspectRatio,
      duration: it.duration,
      quality: it.quality,
      autoReason: it.autoReason,
      parentId: it.id,
      templateName: it.templateName,
      sound: it.kind === "video" ? it.wantSound !== false : undefined,
      enhance: it.enhance !== false,
      sourceUrl: it.sourceUrl,
      editPrompt: it.editPrompt,
      fixNote: it.fixNote,
      purpose: it.purpose,
      keyframeFor: it.keyframeFor,
      refs: it.refs,
      scale: it.scale,
      ...(m0(it)?.id === HD_VIDEO_MODEL.id ? { sound: false, hasAudio: it.hasAudio } : {}),
    });
  }

  function switchKind(k: MediaKind) {
    setKind(k);
    if (template && template.kind !== k) setTemplate(null);
  }

  /** The person tapped Image or Video themselves: stop choosing for them. */
  function pickKind(k: MediaKind) {
    setKindPicked(true);
    setKindWhy(null);
    switchKind(k);
  }

  /** Home's one box: as people type or speak, work out whether they want a picture or a video. */
  function typeHome(text: string) {
    setPrompt(text);
    if (!text.trim()) {
      setKindPicked(false);
      setKindWhy(null);
      return;
    }
    if (kindPicked || template) return;
    const g = guessKind(text);
    if (!g) return;
    setKindWhy(g.why);
    if (g.kind !== kind) switchKind(g.kind);
  }

  function speak(spoken: string, home: boolean) {
    setVoiceError(null);
    const text = joinSpoken(promptNow.current, spoken).slice(0, 2000);
    promptNow.current = text;
    if (home) typeHome(text);
    else setPrompt(text);
  }

  const promptTools = (home: boolean) => (
    <div className="prompt-tools">
      <button
        type="button"
        className={refs.length ? "tool-btn on" : "tool-btn"}
        onClick={() => {
          if (home) setHomeRefsOpen(true);
          setRefsSignal((n) => n + 1);
        }}
        title="Upload a photo of your product, logo, a person who agreed, or a style to match"
      >
        <span aria-hidden>📎</span> Reference{refs.length ? ` · ${refs.length}` : ""}
      </button>
      <VoiceButton onText={(t) => speak(t, home)} onError={setVoiceError} />
    </div>
  );

  // ---------- pieces shared by several views ----------

  const kindTabs = (
    <div className="tabs" role="tablist">
      {(["image", "video"] as MediaKind[]).map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={kind === k}
          className={kind === k ? "tab active" : "tab"}
          onClick={() => pickKind(k)}
        >
          <span className="tab-icon" aria-hidden>
            {k === "image" ? <IconImage /> : <IconVideo />}
          </span>
          {k === "image" ? "Image" : "Video"}
        </button>
      ))}
    </div>
  );

  const categoryChips = (
    <div className="tpl-cats" role="tablist" aria-label="Template groups">
      {([{ id: "all", label: "All" }, ...TEMPLATE_CATEGORIES] as { id: TemplateCategory | "all"; label: string }[]).map((c) => (
        <button key={c.id} role="tab" aria-selected={tplCat === c.id} className={tplCat === c.id ? "chip active" : "chip"} onClick={() => setTplCat(c.id)}>
          {c.label}
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
        {TEMPLATE_MEDIA[t.id] ? (
          <Showcase media={TEMPLATE_MEDIA[t.id]} fit={!!t.size && t.size.w / t.size.h > 1.2} />
        ) : (
          <TemplateMock t={t} colors={t.category === "business" && brandOn ? brand.colors : undefined} name={t.category === "business" && brandOn ? brand.name : undefined} />
        )}
      </span>
      <span className="template-ar">
        {t.kind === "video" ? "Video · " : ""}
        {t.size ? sizeLabel(t.size) : t.aspectRatio}
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
        <div key={ex.prompt} className="inspo-wrap">
        <button
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
        {adaptFor === i ? (
          <AdaptBox
            brand={brand}
            mode={mode}
            kind={ex.kind}
            example={ex.prompt}
            onClose={() => setAdaptFor(null)}
            onDone={(out) => out.prompt && makeAdapted(ex.kind, ex.kind === "video" ? "16:9" : "1:1", out.prompt)}
          />
        ) : (
          <button className="link-btn inspo-mine" onClick={() => setAdaptFor(i)}>
            ✨ Make one like this for my brand
          </button>
        )}
        </div>
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
    return m ? jobCost(m, it.duration, it.wantSound !== false, it.quality) : 0;
  }

  function finalCost(draft: Item): number {
    if (draft.refs?.length) return estimateCost(REFERENCE_IMAGE_MODEL);
    const pick = pickModel({ kind: draft.kind, prompt: draft.prompt, quality: "final", aspectRatio: draft.aspectRatio });
    const m = draft.purpose === "animate" ? animateModelFor(pick.model.id) : pick.model;
    return jobCost(m, fitDuration(m.durations, draft.duration), draft.kind === "video" && draft.wantSound !== false, "final");
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
    const cost = single ? jobCost(m!, total, snd, it.quality) : storyCost(base, shots, snd, !!it.story?.refs?.length);
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

  /** "Sharpen to HD": how much it costs, or null when it's already sharp (or can't be done). */
  function hdPlan(it: Item): { cost: number; scale?: number } | null {
    if (!it.url || it.ad || it.status !== "done") return null;
    if (it.kind === "image") return getModel(it.modelId)?.hd ? null : { cost: estimateCost(HD_IMAGE_MODEL) };
    // The model that made the picture moving (the sound step afterwards doesn't change sharpness).
    const base = it.story ? it.story.shotModelId : it.takes?.best && it.takes.animateModelId ? it.takes.animateModelId : it.modelId;
    const scale = hdScaleFor(base);
    return scale ? { cost: estimateCost(HD_VIDEO_MODEL, it.duration ?? 5), scale } : null;
  }

  /** Makes a sharper, full-size copy of a finished result. The original stays as it is. */
  function doHd(it: Item) {
    const p = hdPlan(it);
    if (!p || !it.url) return;
    const video = it.kind === "video";
    runJob({
      kind: it.kind,
      modelId: video ? HD_VIDEO_MODEL.id : HD_IMAGE_MODEL.id,
      prompt: basePrompt(it),
      aspectRatio: it.aspectRatio,
      duration: it.duration,
      sourceUrl: it.url,
      sound: video ? false : undefined,
      hasAudio: video ? it.hasAudio : undefined,
      scale: p.scale,
      enhance: false,
      parentId: it.id,
      templateName: it.templateName,
      autoReason: video ? "a sharper, full HD copy" : "a sharper copy, twice as big",
    });
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
    const listen = it.kind === "video" && it.hasAudio && !it.ad && !asksForSpeech(basePrompt(it));
    Promise.all([analyzeItem(it), listen ? speechCheck(it.url!) : Promise.resolve(false)])
      .then(([found, speech]) => {
        const a = withSpeech(found, speech)!;
        patchMsg(id, { state: "done" });
        // A clear fault (or a borderline problem) is covered by the promise: credits back or a free remake.
        if (!it.ad && applyPromise(it, a, thread)) return;
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
    if (/^director'?s? notes?$|^(ask|call) the director$/i.test(text) && !it.ad) {
      if (!it.url) reply({ text: "This one didn't finish. Tell me what you'd like and I'll make it again." });
      else directorNotes(it, thread);
      return;
    }
    const intent = readChat(text, it.kind);
    if (intent.type === "check") {
      if (!it.url) reply({ text: "This one didn't finish, so there's nothing to check. Tell me what you'd like and I'll make it again." });
      else checkItem(it, thread);
      return;
    }
    if (it.ad && /\b(shapes?|tiktok|reels?|shorts|instagram|youtube|vertical|square|landscape|9:16|1:1|16:9)\b/i.test(text) && text.length < 80) {
      offerShapes(it, thread);
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
    if (intent.type === "hd") {
      const p = hdPlan(it);
      if (!it.url) reply({ text: "This one didn't finish, so there's nothing to sharpen yet." });
      else if (!p) reply({ text: "This one is already sharp and full size. Tell me what you'd like to change about it." });
      else
        reply({
          text: `I'll make a sharper copy${it.kind === "video" ? " in full HD (1080p)" : ", twice as big"}. Your original stays as it is. That costs ${price(p.cost)}.`,
          offers: [{ label: "✨ Sharpen to HD", cost: p.cost, act: { type: "hd" } }],
          state: "open",
        });
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
    if (offer.free) nextFree.current = true;
    if (a.type === "fix") err = fixItem(it, a.note, a.newPrompt, a.how);
    else if (a.type === "length") doLength(it, a.seconds);
    else if (a.type === "final") makeFinal(it);
    else if (a.type === "sound") addSound(it);
    else if (a.type === "video") doVideo(it);
    else if (a.type === "hd") doHd(it);
    else if (a.type === "shape" && it.ad) makeShape(it, a.aspectRatio);
    else if (a.type === "ad" && it.ad) startAd(changedAdJob(it.ad, a.plan).job, { parentId: it.id, fixNote: a.note, aspectRatio: it.aspectRatio });
    if (offer.free) {
      if (err || nextFree.current) nextFree.current = false;
      else logFreeRemake(it.id, a.type === "fix" ? a.note.slice(0, 120) : "Free remake");
    }
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
      chips.push({ label: "✨ Try a new hook", text: "Give scene 1 a new, more gripping hook (new picture and voice line). Keep everything else the same." });
      chips.push({ label: "📐 Other shapes", text: "Make it in other shapes for TikTok, Instagram and YouTube" });
      chips.push({ label: "🎙️ Change the voiceover", text: "Make the voiceover warmer and slower" });
      chips.push({ label: "🎵 Different music", text: "music: more upbeat" });
    } else if (selected.kind === "video") {
      chips.push({ label: "🎬 Director's notes", text: "Director's notes" });
      const next = nextLength(selected.duration, LONG_LENGTHS);
      if ((selected.duration ?? 0) < MAX_STORY_SECONDS) chips.push({ label: `⏱️ Make it ${next}s`, text: `Make it ${next} seconds` });
      if (!selected.hasAudio) chips.push({ label: "🔊 Add sound", text: "Add sound" });
    } else chips.push({ label: "🎬 Turn into a video", text: "Turn it into a video" });
    if (!selected.ad && hdPlan(selected)) chips.push({ label: "✨ Sharpen to HD", text: "Sharpen to HD" });
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
                    {o.label} · {mode === "demo" || o.free ? "Free" : `est. ${formatCost(o.cost)}`}
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

  const directorShown = director && director.kind === kind;
  const directorPanel = (
    <div className="director">
      {!directorShown && (
        <button className="director-ask" onClick={() => askDirector()} disabled={directorBusy || mode === "locked"}>
          <span>
            {kind === "image" ? "📸" : "🎬"} <strong>{directorBusy ? "The director is thinking..." : `Ask the creative director for your ${kind === "image" ? "picture" : "video"}`}</strong>
            <span className="muted small">
              {kind === "image"
                ? " Get 3 ways to frame it as one still shot: angle, lens, light and composition. Pick one with a click."
                : " Get 3 ways to film it: shots, camera moves, pacing, length and shape. Pick one with a click."}
            </span>
          </span>
          <span className="tag">{mode === "demo" ? "Free" : "under 1 cent"}</span>
        </button>
      )}
      {directorShown && (
        <div className="director-box">
          <div className="director-head">
            <strong>{kind === "image" ? "📸 Directing your picture" : "🎬 Directing your video"}</strong>
            <button className="link-btn" onClick={() => setDirector(null)}>
              Close
            </button>
          </div>
          <p className="muted small director-kind">
            {kind === "image"
              ? "A picture is one frame from one camera, so each direction is a single shot. Want several shots or movement? Switch to Video clip."
              : "Each direction plans the shots, the camera moves and the timing. The length and shape fill in when you pick one."}
          </p>
          {director.read && <p className="muted small">{director.read}</p>}
          <div className="director-cards">
            {director.directions.map((d, i) => (
              <div key={d.name + i} className={directorPicked === i ? "director-card picked" : "director-card"}>
                <div className="director-card-head">
                  <strong>{d.name}</strong>
                  <span className="muted small">
                    {kind === "video" && d.seconds ? `${d.seconds}s · ` : ""}
                    {d.shape}
                  </span>
                </div>
                <p className="small">{d.why}</p>
                <details>
                  <summary className="muted small">See the direction</summary>
                  <p className="small">{d.prompt}</p>
                </details>
                <button className={directorPicked === i ? "pill active" : "pill"} onClick={() => applyDirection(d, i)}>
                  {directorPicked === i ? "✓ Using this" : "Use this"}
                </button>
              </div>
            ))}
          </div>
          {directorPicked !== null && (
            <button className="link-btn" onClick={() => { setPrompt(director.idea); setDirectorPicked(null); }}>
              ↩ Back to my own words
            </button>
          )}
          {director.questions.length > 0 && (
            <div className="director-qs">
              <span className="small">To make it even better, tell me:</span>
              <ul className="small">
                {director.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <div className="product-link-row">
                <input className="text-input" maxLength={600} placeholder="Your answers, in a few words" value={directorAnswers} onChange={(e) => setDirectorAnswers(e.target.value)} />
                <button className="pill" disabled={!directorAnswers.trim() || directorBusy} onClick={() => askDirector(true)}>
                  {directorBusy ? "Thinking..." : "Direct it again"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {directorError && <p className="error small">{directorError}</p>}
    </div>
  );

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
    {promptTools(false)}
    {voiceError && <p className="notice warn small-notice">{voiceError}</p>}
    {kind === "image" && describesSeveralShots(prompt) && (
      <div className="notice warn small-notice shots-warning">
        <span>⚠️ This describes more than one shot, with a cut. A picture can only show one shot, so the result would mix them up.</span>
        <span className="shots-actions">
          <button className="pill active" onClick={() => switchKind("video")}>
            🎬 Make it a video
          </button>
          <button className="pill" onClick={() => setPrompt(firstShot(prompt))}>
            Keep only the first shot
          </button>
        </span>
      </div>
    )}
    {directorPanel}
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
    <ReferencesBox refs={refs} onChange={setRefs} mode={mode} kit={kitPics} onSave={saveToKit} openSignal={refsSignal} />
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
          {template.size && (
            <p className="muted small tpl-size">
              📐 Comes out at {sizeLabel(template.size)} pixels, the right size for {template.use}.
            </p>
          )}
          {template.category === "business" &&
            (brandOn ? (
              <p className="muted small tpl-size">
                🎨 Uses your brand kit{brand.name ? ` (${brand.name})` : ""}: colours and style
                {brand.pictures.some((r) => r.kind === "logo") ? ", and your logo is added below" : ". Add your logo to the kit to put it on the design"}.
              </p>
            ) : (
              <button className="link-btn brand-setup" onClick={() => go("brand")}>
                🎨 {hasBrand(brand) ? "Switch on “Use my brand kit” in step 1" : "Set up your brand kit"} so this uses your name, colours and logo
              </button>
            ))}
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
            est. {formatCost(jobCost(m, m.durations?.[0], false))} {m.kind === "video" ? `per ${m.durations?.[0]}s clip` : "per image"}
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

  // ---------- Brand kit switch, shown in step 1 ----------

  const brandChip = hasBrand(brand) ? (
    <label className="brand-chip">
      <input type="checkbox" checked={useBrand} onChange={(e) => setUseBrand(e.target.checked)} />
      <span>
        Use my brand kit
        {brand.name ? <strong> · {brand.name}</strong> : null}
        {(brand.colors ?? []).map((c) => (
          <span key={c} className="brand-dot" style={{ background: c }} title={colorName(c)} />
        ))}
      </span>
      <button className="link-btn" onClick={(e) => { e.preventDefault(); go("brand"); }}>
        Edit
      </button>
    </label>
  ) : (
    <button className="link-btn brand-setup" onClick={() => go("brand")}>
      🎨 Set up a brand kit, so everything you make uses your name, colours and pictures
    </button>
  );

  // ---------- Full ad: the brief, then the plan to review ----------

  const adBrief = (
    <>
      <section className="g-step">
        <div className="g-head">
          <span className="g-num">2</span>
          <h2>Tell us about your ad</h2>
        </div>
        <div className="product-link">
          <label className="sub-label" htmlFor="ad-link">
            🔗 Start from your product page <span className="step-opt">optional</span>
          </label>
          <form
            className="product-link-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (productLink.trim()) readProductLink();
            }}
          >
            <input id="ad-link" className="text-input" maxLength={1000} placeholder="https://yourshop.com/products/..." value={productLink} onChange={(e) => setProductLink(e.target.value)} />
            <button className="pill" type="submit" disabled={!productLink.trim() || !!productBusy}>
              {productBusy ?? "Fill in for me"}
            </button>
          </form>
          {productPics.length > 0 && (
            <div className="product-pics">
              <span className="muted small">Pictures from the page. Pick the ones that show your product:</span>
              <div className="refs-list">
                {productPics.map((u) => {
                  const on = productPicked.includes(u);
                  return (
                    <button key={u} className={on ? "ref-thumb ref-pick picked" : "ref-thumb ref-pick"} onClick={() => setProductPicked(on ? productPicked.filter((x) => x !== u) : [...productPicked, u])} aria-pressed={on}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="Product page picture" referrerPolicy="no-referrer" />
                      <span className="ref-pick-label">{on ? "✓ Use" : "＋ Use"}</span>
                    </button>
                  );
                })}
              </div>
              <label className="refs-consent">
                <input type="checkbox" checked={productConsent} onChange={(e) => setProductConsent(e.target.checked)} />
                <span>This is my product and I may use these pictures.</span>
              </label>
              <button className="refs-add" disabled={!productConsent || !productPicked.length || !!productBusy || mode === "locked"} onClick={useProductPics}>
                {productBusy ?? "Use the picked pictures"}
              </button>
            </div>
          )}
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
        <ReferencesBox refs={refs} onChange={setRefs} mode={mode} kit={kitPics} onSave={saveToKit} />
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
        <label className="sub-label" htmlFor="ad-language">
          Voiceover language
        </label>
        <select id="ad-language" className="text-input ad-language" value={brief.language ?? "English"} onChange={(e) => setBrief({ ...brief, language: e.target.value })}>
          {AD_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
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
          {formatCost(sceneCount(brief.seconds) * (AD_PRICES.scene + AD_PRICES.picture) + (refs.length ? 0.06 : 0.1) + checkCost(sceneCount(brief.seconds)))} to make.
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
                <VoiceCount line={sc.voice} seconds={SCENE_SECONDS} language={brief.language} />
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
              <OwnVoiceOptions eleven={eleven} current={adPlan.voice} />
            </select>
          </label>
        </div>
        {isOwnVoice(adPlan.voice) && <p className="muted small g-hint">Your ElevenLabs voice reads the voiceover, billed to your ElevenLabs account, so it isn&apos;t in our price.</p>}
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
        <label className="check-toggle">
          <input type="checkbox" checked={adCheck} onChange={(e) => setAdCheck(e.target.checked)} />
          <span>
            <strong>🔍 Quality check</strong> <span className="tag tag-rec">Recommended</span>
            <br />
            <span className="muted small">
              An AI looks at every shot before it&apos;s filmed and at every finished scene, then fixes clearly wrong ones on its own (wrong product, broken hands,
              impossible movement). It remakes at most {maxRedos(adPlan.scenes.length)} scene{maxRedos(adPlan.scenes.length) > 1 ? "s" : ""}, so it never costs more than
              up to ${costRange(redoCap(adPlan.scenes.length))[1].toFixed(2)} extra, and only if something needs fixing. The check itself is included in the price.
            </span>
          </span>
        </label>
        <button className="generate" onClick={buildPlannedAd} disabled={mode === "locked" || !!adBusy}>
          <span className="generate-label">🎬 Build my {adPlan.seconds}-second ad</span>
          <span className="generate-cost">{mode === "demo" ? "Free" : `est. ${formatCost(adCost(adPlan, refs.length > 0, adCheck))}`}</span>
        </button>
        <p className="hint">
          Makes every scene{refs.length ? " with your product" : ""}, the end card, the voiceover and the music, and gives you one finished video. Takes about{" "}
          {Math.round(3 + adPlan.scenes.length * 1.6)} minutes. {mode === "demo" ? `Free in demo mode (live estimate ${formatCost(adCost(adPlan, refs.length > 0, adCheck))}).` : ""} {COST_NOTE}
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
                pickKind(k);
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
        {brandChip}
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
            {adaptTemplate ? (
              <AdaptBox
                brand={brand}
                mode={mode}
                kind={template.kind}
                example={fillTemplate(template, Object.fromEntries(template.fields.map((f) => [f.key, f.placeholder])))}
                fields={template.fields.map(({ key, label, placeholder }) => ({ key, label, placeholder }))}
                onClose={() => setAdaptTemplate(false)}
                onDone={(out) => {
                  setAdaptTemplate(false);
                  if (!out.fields) return;
                  const next = { ...fields, ...out.fields };
                  setFields(next);
                  setPrompt(fillTemplate(template, next));
                }}
              />
            ) : (
              <button className="link-btn adapt-open" onClick={() => setAdaptTemplate(true)}>
                ✨ Make one like this for my brand: we fill in the blanks for your product
              </button>
            )}
            {templateFields}
            <label className="sub-label" htmlFor="prompt">
              Your prompt (edit freely)
            </label>
            {describeBlock}
          </>
        ) : (
          <>
            <IdeasBox brand={brand} mode={mode} open={ideasOpen} onOpen={setIdeasOpen} onUse={makeIdea} />
            {describeBlock}
            <div className="g-or">
              <span>or start from a template</span>
            </div>
            {categoryChips}
            <div className="templates g-templates" id="templates">
              {kindTemplates.map(templateCard)}
            </div>
            {!kindTemplates.length && <p className="muted small">No {kind} templates in this group yet. Pick another group.</p>}
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
      <summary>✏️ Prompt and settings for a new {adMode ? "ad" : kind}</summary>
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

  // A new take of the selected result, priced before anything is spent. Big jobs ask once more.
  const reCost = selected && selected.status !== "pending" && mode !== "locked" ? recreateCost(selected) : null;
  const rePrice = reCost === null ? "" : mode === "demo" ? "free in demo" : `est. ${formatCost(reCost)}`;
  const reAsking = !!selected && recreateAsk === selected.id && reCost !== null;
  const reButton = selected && reCost !== null && (
    <button
      className="btn btn-recreate"
      title="Make a new take right away, with the same prompt and settings"
      onClick={() => (mode !== "demo" && reCost >= 1 ? setRecreateAsk(selected.id) : recreate(selected))}
    >
      {selected.status === "failed" ? "Try again" : "Re-create"} <span className="btn-price">{rePrice}</span>
    </button>
  );

  const stage = selected ? (
    <div className="canvas-wrap">
      <div
        className={`canvas canvas-${selected.aspectRatio.replace(":", "x")}${selSize ? " canvas-sized" : ""}`}
        style={selSize ? ({ aspectRatio: `${selSize.w} / ${selSize.h}`, "--ar": selSize.w / selSize.h } as React.CSSProperties) : undefined}
      >
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
                onClick={() => editEnhanced(selected)}
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
              {selSize && (
                <>
                  <dt>Size</dt>
                  <dd>
                    {sizeLabel(selSize)} px <span className="muted small">(Download gives this exact size)</span>
                  </dd>
                  {templateByName(selected.templateName)?.tip && (
                    <>
                      <dt>How to use</dt>
                      <dd>{templateByName(selected.templateName)!.tip}</dd>
                    </>
                  )}
                </>
              )}
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
        {selected.status === "done" && selected.takes?.best && <p className="muted small">🎯 {takesNote(selected.kind, selected.takes)}</p>}
        {selected.promiseCheck === "running" && <p className="muted small promise-note">🔍 Checking it for clear faults…</p>}
        {selected.promise && <p className="promise-note">🛡️ {selected.promise.note}</p>}
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
          {!reAsking && reButton}
          <button className="btn" onClick={() => reuse(selected)}>
            Reuse prompt
          </button>
          <button className="btn btn-danger" onClick={() => remove(selected.id)}>
            Delete
          </button>
        </div>
        {reAsking && (
          <div className="recreate-ask">
            <p>
              Make a new take of this {selected.ad ? "ad" : selected.kind} with the same prompt and settings? Estimated cost{" "}
              <strong>{formatCost(reCost!)}</strong>
              {selected.ad?.check?.on ? ", plus a little more only if the quality check has to fix a scene" : ""}. {COST_NOTE}
            </p>
            <div className="viewer-actions">
              <button className="btn btn-light" onClick={() => recreate(selected)}>
                Yes, make it
              </button>
              <button className="btn" onClick={() => setRecreateAsk(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
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
      {ADVERTISE_PROMISE && (
        <p className="home-promise">
          🛡️ Pay only for videos that work. <Link href="/pricing#promise">How it works</Link>
        </p>
      )}

      <div className="composer-lite">
        <div className="prompt-box">
          <textarea
            id="home-prompt"
            className="prompt"
            rows={3}
            maxLength={2000}
            placeholder={`Describe an image or video... e.g. ${EXAMPLES[kind][0]}`}
            value={prompt}
            onChange={(e) => typeHome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
            }}
          />
        </div>
        {promptTools(true)}
        {prompt.trim() && (
          <p className="kind-note">
            {kind === "image" ? "📸 You'll get a picture" : "🎬 You'll get a video"}
            {kindWhy && !kindPicked ? `, because ${kindWhy}.` : "."}{" "}
            <button className="link" onClick={() => pickKind(kind === "image" ? "video" : "image")}>
              Make {kind === "image" ? "a video" : "a picture"} instead
            </button>
          </p>
        )}
        {voiceError && <p className="notice warn small-notice">{voiceError}</p>}
        {(homeRefsOpen || refs.length > 0) && (
          <ReferencesBox refs={refs} onChange={setRefs} mode={mode} kit={kitPics} onSave={saveToKit} openSignal={refsSignal} />
        )}
        <div className="lite-bar">
          <div className="lite-left">
            <div className="mini-tabs">
              {(["image", "video"] as MediaKind[]).map((k) => (
                <button key={k} className={kind === k ? "active" : ""} onClick={() => pickKind(k)}>
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
      <button
        className="link-btn home-ideas"
        onClick={() => {
          setAdMode(false);
          setTemplate(null);
          setIdeasOpen(true);
          setComposing(true);
          go("create");
        }}
      >
        💡 Not sure what to make? Get 5 ideas for your business
      </button>

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
        <p className="muted">Ready-made designs for your business, your socials and your ads, already the right size. Pick one, fill in the blanks (or let us fill them for your brand), and generate.</p>
        {categoryChips}
      </div>
      {TEMPLATE_CATEGORIES.filter((c) => tplCat === "all" || tplCat === c.id).map((c) => (
        <section key={c.id} className="home-section">
          <div className="section-head">
            <h2>{c.label}</h2>
          </div>
          <p className="muted small tpl-hint">{c.hint}</p>
          {c.id === "business" && !hasBrand(brand) && (
            <button className="link-btn brand-setup" onClick={() => go("brand")}>
              🎨 Set up your brand kit first, so these use your name, colours and logo
            </button>
          )}
          <div className="template-grid">{templatesIn(c.id).map(templateCard)}</div>
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
          <button className={view === "brand" ? "nav-item active" : "nav-item"} onClick={() => go("brand")}>
            <span className="nav-icon" aria-hidden>
              <IconBrand />
            </span>
            Brand kit
            {hasBrand(brand) && <span className="brand-dot" style={{ background: brand.colors?.[0] ?? "var(--accent)" }} aria-hidden />}
          </button>
          <Link href="/pricing" className="nav-item">
            <span className="nav-icon" aria-hidden>
              ◇
            </span>
            Pricing
          </Link>
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
        {view === "brand" && <BrandKit brand={brand} onChange={setBrand} mode={mode} onUseIdea={makeIdea} eleven={eleven} onEleven={setEleven} />}
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
/** fit: show the whole picture (wide banners and backgrounds) instead of filling the card. */
function Showcase({ media, fit }: { media?: ShowcaseMedia; fit?: boolean }) {
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
    return <img className={fit ? "showcase showcase-fit" : "showcase"} src={media.src} alt="" loading="lazy" onError={() => setFailed(true)} />;
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
  // A video's checked first picture is its own step, before the video.
  const pre = item.kind === "video" && item.takes ? 1 : 0;
  if (item.takes?.step) {
    const view = progressView({
      phase: "working",
      elapsedSec: (now - (item.stepStartedAt ?? now)) / 1000,
      typicalSec: /check|pick/i.test(item.takes.step) ? 15 : 20,
      step: 1,
      steps: item.kind === "video" ? 1 + (silentNeedsSound ? 2 : 1) : 1,
      stepLabel: item.takes.step,
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
  const steps = (silentNeedsSound ? 2 : 1) + pre;
  const step = (item.stage === "sound" && silentNeedsSound ? 2 : 1) + pre;
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

/** One plain line on the work done behind the scenes, shown with the result. */
function takesNote(kind: MediaKind, t: Takes): string {
  if (kind === "image") return `We made ${t.urls?.length ?? t.count} takes and our checker kept the best one.`;
  const pics = t.urls?.length ?? 1;
  return pics > 1
    ? `We set up the first shot ${pics} ways, our checker kept the best one, then we brought it to life.`
    : "We set up the first shot as a picture, our checker looked it over, then we brought it to life.";
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


type FixMode = "edit" | "remake";

/** Camera, angle and layout changes need a fresh picture; small changes can be edited in place. */
function suggestFixMode(note: string): FixMode {
  return /\b(angle|camera|view|viewpoint|perspective|shot from|from the (side|back|front|top|left|right|other)|side of|behind|overhead|facing|faces|face (the|away|towards?)|turn(ed)? around|looking at|layout|position|where|wide shot|close.?up|zoom|realistic|wouldn'?t|couldn'?t|can'?t see|other side|opposite|rearrange|move (the|him|her|them)|swap)\b/i.test(
    note,
  )
    ? "remake"
    : "edit";
}

/** Listens for a voice saying words in a finished video. A failed listen counts as no speech. */
async function speechCheck(url: string): Promise<boolean> {
  try {
    const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "speech", url }) });
    let data = await res.json().catch(() => ({}));
    if (!res.ok) return false;
    const started = Date.now();
    while (data.status !== "COMPLETED") {
      if (data.status === "FAILED" || Date.now() - started > 2 * 60 * 1000) return false;
      await new Promise((r) => setTimeout(r, 2000));
      const r = await fetch(`/api/analyze?kind=speech&requestId=${encodeURIComponent(data.requestId)}`);
      data = { ...(await r.json().catch(() => ({}))), requestId: data.requestId };
    }
    return data.speech === true;
  } catch {
    return false;
  }
}

const SPEECH_PROBLEM = "Someone talks, but no speech was asked for.";

/** Adds "unwanted speech" to a check's result when the listen heard words. */
function withSpeech(a: Analysis | null, speech: boolean): Analysis | null {
  if (!speech) return a;
  const base: Analysis = a ?? { problems: [], fix: "", prompt: "" };
  return {
    ...base,
    problems: [SPEECH_PROBLEM, ...base.problems].slice(0, 4),
    faults: ["unwanted_speech", ...(base.faults ?? [])],
    serious: true,
    fix: base.fix || "No one speaks. Sound effects and ambience only.",
  };
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
  // Pictures made from a sized template (a Teams background, an Instagram post...) come out at that exact size.
  const t = templateByName(item.templateName);
  const size = sizedFor(item);
  if (t && size) {
    const sized = await toSize(item.url, size).catch(() => null);
    if (sized) {
      const a = document.createElement("a");
      a.href = sized;
      a.download = `${t.id}-${size.w}x${size.h}-${item.id.slice(0, 6)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(sized), 5000);
      return;
    }
  }
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

/** The exact size a picture should come out at: only when it was made from a sized template in the template's own shape. */
function sizedFor(item: Item): TemplateSize | undefined {
  const t = item.kind === "image" ? templateByName(item.templateName) : undefined;
  return t?.size && t.aspectRatio === item.aspectRatio ? t.size : undefined;
}

/** Trims a picture to the template's shape (keeping the middle) and resizes it to the exact size. Returns a PNG link. */
async function toSize(url: string, size: TemplateSize): Promise<string> {
  const src = url.startsWith("data:") ? url : URL.createObjectURL(await (await fetch(url)).blob());
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = img.naturalWidth || size.w;
    const h = img.naturalHeight || size.h;
    const { sx, sy, sw, sh } = coverCrop(w, h, size);
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size.w, size.h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("could not make the picture");
    return URL.createObjectURL(blob);
  } finally {
    if (src !== url) URL.revokeObjectURL(src);
  }
}

/** A drawn preview for a template without an example yet: its real shape, in the brand's colours when there are some. */
function TemplateMock({ t, colors, name }: { t: Template; colors?: string[]; name?: string }) {
  const ratio = t.size ? t.size.w / t.size.h : t.aspectRatio === "16:9" ? 16 / 9 : t.aspectRatio === "9:16" ? 9 / 16 : 1;
  const [c1, c2, c3] = colors?.length ? [colors[0], colors[1] ?? colors[0], colors[2] ?? colors[1] ?? colors[0]] : [];
  const call = t.id === "teams-background" || t.id === "zoom-background";
  return (
    <span className="mesh tpl-mock-wrap" style={c1 ? ({ "--b1": c1, "--b2": c2, "--b3": c3 } as React.CSSProperties) : undefined}>
      <span className="blob b1" />
      <span className="blob b2" />
      <span className="blob b3" />
      <span className={ratio >= 1 ? "tpl-mock wide" : "tpl-mock tall"} style={{ aspectRatio: String(ratio) }}>
        {call && <span className="tpl-person" />}
        <span className="tpl-mock-label">
          {t.emoji} {name && t.category === "business" ? name : ""}
        </span>
      </span>
    </span>
  );
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

/** How long a voice line is against what fits its seconds (characters for Japanese and Chinese). */
function VoiceCount({ line, seconds, language }: { line: string; seconds: number; language?: string }) {
  const chars = maxVoiceChars(seconds, language);
  const n = chars ? line.length : line.split(/\s+/).filter(Boolean).length;
  const max = chars ?? maxVoiceWords(seconds);
  return (
    <span className={n > max ? "error-text" : "muted"}>
      ({n}/{max} {chars ? "characters" : "words"})
    </span>
  );
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
      {job.check?.on && (
        <div className="check-log">
          <strong>🔍 Quality check</strong>
          {job.check.log.length ? (
            <ul>
              {job.check.log.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{job.clips.every((c) => c.checked) ? "Every scene passed, nothing needed remaking." : "Checks each scene as it's made."}</p>
          )}
        </div>
      )}
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
