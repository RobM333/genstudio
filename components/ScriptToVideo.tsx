"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppMode } from "@/lib/config";
import { COST_NOTE, type AspectRatio } from "@/lib/models";
import { AD_VOICES, DEFAULT_VOICE } from "@/lib/adplan";
import { brandLine } from "@/lib/brand";
import { characterRefs } from "@/lib/characters";
import { checkPrompt } from "@/lib/safety";
import {
  applyLook,
  beatSeconds,
  buildMinutes,
  formatLength,
  formatRange,
  LOOKS,
  lookRange,
  MAX_CLIP_BYTES,
  MAX_CLIPS,
  MAX_RECORDING_BYTES,
  newScriptJob,
  PLAN_BATCH,
  SCRIPT_NAME,
  scriptCost,
  scriptPlanWithRules,
  scriptSeconds,
  shotCost,
  splitScript,
  type MyClip,
  type ScriptBeat,
  type ScriptJob,
  type ScriptLook,
  type ScriptPlan,
  type ShotSource,
  type StockPick,
  type VoiceChoice,
} from "@/lib/script";
import { brandInfo, type Brand } from "./BrandKit";
import type { RefItem } from "./ReferencesBox";
import { usableVoices, type ElevenConnection } from "./elevenConnect";
import { mediaSeconds } from "./scriptRunner";

// Script to Video: paste your own script (any length), keep every word, and
// see every line beside the shot planned under it, with the price, before
// anything is made. Shots can be AI video, free stock video, AI stills with a
// slow move, or your own clips.

type Draft = {
  script: string;
  look: ScriptLook;
  shape: AspectRatio;
  plan: ScriptPlan | null;
  voice: VoiceChoice;
  captions: boolean;
  music: boolean;
  clips: MyClip[];
  star: string; // "" none, "kit" the brand kit pictures, or a saved character's id
};

const STORE = "genstudio.script.v1";
const START: Draft = { script: "", look: "mix", shape: "16:9", plan: null, voice: { kind: "stock", voice: DEFAULT_VOICE }, captions: true, music: true, clips: [], star: "" };

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORE);
    const d = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
    if (d && typeof d.script === "string") return { ...START, ...d, clips: Array.isArray(d.clips) ? d.clips : [] };
  } catch {
    // nothing saved, or storage blocked
  }
  return START;
}

const SOURCE_LABEL: Record<ShotSource, string> = { ai: "AI video", stock: "Stock", still: "AI still", mine: "My clip" };
const SOURCE_HINT: Record<ShotSource, string> = {
  ai: "A fresh AI video shot",
  stock: "A free stock video from Pexels or Pixabay",
  still: "An AI picture with a slow zoom or pan",
  mine: "One of your own clips",
};
const SHOWN = 40; // lines shown before "Show all"

/** Sends a big file straight to storage (our server only hands out the upload address). */
async function uploadFile(file: File, kind: "clip" | "recording"): Promise<string> {
  const res = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, type: file.type, size: file.size }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "We couldn't upload that file.");
  if (data.demo) return URL.createObjectURL(file); // demo mode: the file stays in this browser
  const put = await fetch(data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!put.ok) throw new Error("The upload didn't finish. Please try again.");
  return String(data.fileUrl);
}

export default function ScriptToVideo({
  mode,
  brand,
  brandOn,
  kitRefs,
  eleven,
  language,
  onStart,
}: {
  mode: AppMode;
  brand: Brand;
  brandOn: boolean;
  kitRefs: RefItem[];
  eleven: ElevenConnection | null;
  language: string;
  onStart: (job: ScriptJob) => string | null;
}) {
  const [d, setD] = useState<Draft>(START);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stockKeys, setStockKeys] = useState({ on: false, wideOnly: true });
  const [showAll, setShowAll] = useState(false);
  const [clipConsent, setClipConsent] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const stockOptions = useRef(new Map<number, { q: string; picks: StockPick[]; at: number }>());

  useEffect(() => {
    setD(loadDraft());
    setLoaded(true);
    fetch("/api/stock")
      .then((r) => r.json())
      .then((j) => setStockKeys({ on: Boolean(j.on), wideOnly: j.wideOnly !== false }))
      .catch(() => setStockKeys({ on: false, wideOnly: true }));
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      // Clips kept only in this browser (demo mode) can't be saved.
      localStorage.setItem(STORE, JSON.stringify({ ...d, clips: d.clips.filter((c) => !c.url.startsWith("blob:")), voice: d.voice.kind === "recording" && d.voice.url.startsWith("blob:") ? START.voice : d.voice }));
    } catch {
      // storage blocked: the draft just won't be remembered
    }
  }, [d, loaded]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  // Stock for this shape: Pixabay alone only has wide videos.
  const stockOn = stockKeys.on && (d.shape === "16:9" || !stockKeys.wideOnly);
  const lines = useMemo(() => (d.plan ? d.plan.beats.map((b) => b.text) : splitScript(d.script)), [d.plan, d.script]);
  const seconds = d.plan ? scriptSeconds(d.plan.beats) : scriptSeconds(lines.map((text) => ({ text })));
  const extras = { voice: d.voice.kind, captions: d.captions, music: d.music };
  const characters = (brand.characters ?? []).filter((c) => c.sheetUrl && c.sheetToken);
  const ownVoices = usableVoices(eleven);

  // ---------- planning ----------
  async function plan() {
    setError(null);
    if (lines.length === 0) return setError("Paste your script first.");
    const star = d.star === "kit" ? "the brand's own character or product from the reference pictures" : characters.find((c) => c.id === d.star)?.name ?? "";
    const brandText = brandOn ? brandLine(brandInfo(brand)) : "";
    let out: ScriptPlan = { title: "", look: "", music: "", beats: [] };
    try {
      for (let i = 0; i < lines.length; i += PLAN_BATCH) {
        const batch = lines.slice(i, i + PLAN_BATCH);
        setBusy(lines.length > PLAN_BATCH ? `Planning lines ${i + 1} to ${i + batch.length} of ${lines.length}...` : "Planning your shots...");
        const res = await fetch("/api/scriptplan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: batch, first: i === 0, look: out.look, brand: brandText, star }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Couldn't plan the shots. Please try again.");
        if (i === 0) out = { title: data.title || "", look: data.look || "", music: data.music || "", beats: [] };
        out.beats.push(...(data.beats as ScriptBeat[]).map((b) => ({ ...b, source: "still" as ShotSource })));
      }
      const rules = scriptPlanWithRules(lines);
      out = { title: out.title || rules.title, look: out.look || rules.look, music: out.music || rules.music, beats: out.beats };
      const next = applyLook(out, d.look, stockOn);
      set({ plan: next });
      setShowAll(false);
      stockOptions.current.clear();
      await findStock(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Finds a stock video for every stock line that doesn't have one yet (free). */
  async function findStock(p: ScriptPlan | null = d.plan) {
    if (!p || !stockOn) return;
    const todo = p.beats.map((b, i) => ({ b, i })).filter(({ b }) => b.source === "stock" && !b.stock && b.stockTried !== b.search);
    for (let k = 0; k < todo.length; k++) {
      const { b, i } = todo[k];
      setBusy(`Finding stock videos (${k + 1} of ${todo.length})...`);
      const res = await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: b.search, shape: d.shape, seconds: beatSeconds(b.text) + 1 }) });
      const data = await res.json().catch(() => ({}));
      const picks = (data.picks ?? []) as StockPick[];
      stockOptions.current.set(i, { q: b.search, picks, at: 0 });
      setD((x) => (x.plan ? { ...x, plan: { ...x.plan, beats: x.plan.beats.map((bb, j) => (j === i ? { ...bb, stock: picks[0], stockTried: b.search } : bb)) } } : x));
    }
    setBusy(null);
  }

  const editBeat = (i: number, patch: Partial<ScriptBeat>) => setD((x) => (x.plan ? { ...x, plan: { ...x.plan, beats: x.plan.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) } } : x));

  function pickLook(look: ScriptLook) {
    set({ look, plan: d.plan ? applyLook(d.plan, look, stockOn) : null });
    if (d.plan) setTimeout(() => findStock(applyLook(d.plan!, look, stockOn)), 0);
  }

  function swap(i: number, source: ShotSource) {
    if (source === "mine" && !d.clips.length) return setError("Upload one of your own clips first (step 4), then pick it here.");
    setError(null);
    editBeat(i, { source, pinned: true, clip: source === "mine" ? (d.plan!.beats[i].clip ?? 0) : d.plan!.beats[i].clip });
    if (source === "stock") setTimeout(() => findStock(), 0);
  }

  function nextStock(i: number) {
    const o = stockOptions.current.get(i);
    if (!o?.picks.length) return;
    o.at = (o.at + 1) % o.picks.length;
    editBeat(i, { stock: o.picks[o.at] });
  }

  // ---------- your own clips and recording ----------
  async function addClips(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    if (!clipConsent) return setError("Please tick the box to confirm these are your clips first.");
    const room = MAX_CLIPS - d.clips.length;
    const list = [...files].slice(0, Math.max(0, room));
    if (!list.length) return setError(`Up to ${MAX_CLIPS} clips in one video.`);
    const added: MyClip[] = [];
    try {
      for (let k = 0; k < list.length; k++) {
        const f = list[k];
        if (f.size > MAX_CLIP_BYTES) throw new Error(`"${f.name}" is too big. Please keep each clip under ${Math.round(MAX_CLIP_BYTES / 1024 / 1024)} MB.`);
        setBusy(`Uploading ${f.name} (${k + 1} of ${list.length})...`);
        const local = URL.createObjectURL(f);
        const secs = (await mediaSeconds(local, "video")) ?? 5;
        URL.revokeObjectURL(local);
        const url = await uploadFile(f, "clip");
        added.push({ url, name: f.name.slice(0, 60), seconds: Math.round(secs * 10) / 10 });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (added.length) setD((x) => ({ ...x, clips: [...x.clips, ...added] }));
      setBusy(null);
    }
  }

  /** Puts each of your clips under a line, spread evenly through the video; the other lines keep their shots. */
  function spreadClips() {
    if (!d.plan || !d.clips.length) return;
    const n = d.plan.beats.length;
    const step = Math.max(1, Math.floor(n / d.clips.length));
    const at = new Map(d.clips.map((_, k) => [Math.min(n - 1, k * step), k]));
    set({ plan: { ...d.plan, beats: d.plan.beats.map((b, i) => (at.has(i) ? { ...b, source: "mine", clip: at.get(i), pinned: true } : b)) } });
  }

  function removeClip(k: number) {
    setD((x) => ({
      ...x,
      clips: x.clips.filter((_, j) => j !== k),
      plan: x.plan ? { ...x.plan, beats: x.plan.beats.map((b) => (b.source === "mine" && b.clip === k ? { ...b, source: "still", clip: undefined, pinned: false } : b.source === "mine" && (b.clip ?? 0) > k ? { ...b, clip: (b.clip ?? 0) - 1 } : b)) } : x.plan,
    }));
  }

  async function addRecording(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setError(null);
    if (!voiceConsent) return setError("Please tick the box to confirm it's your voice, or that you have permission, first.");
    if (f.size > MAX_RECORDING_BYTES) return setError(`Please keep the recording under ${Math.round(MAX_RECORDING_BYTES / 1024 / 1024)} MB.`);
    try {
      setBusy("Uploading your recording...");
      const local = URL.createObjectURL(f);
      const secs = (await mediaSeconds(local, "audio")) ?? seconds;
      URL.revokeObjectURL(local);
      const url = await uploadFile(f, "recording");
      set({ voice: { kind: "recording", url, seconds: Math.round(secs * 10) / 10, name: f.name.slice(0, 60) } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---------- build ----------
  const cost = d.plan ? scriptCost(d.plan, extras) : 0;
  const range = (usd: number): [number, number] => [Math.max(0.01, Math.floor(usd * 0.9 * 100) / 100), Math.ceil(usd * 1.15 * 100) / 100];
  const price = (r: [number, number]) => (mode === "demo" ? "Free" : `est. ${formatRange(r)}`);

  function go() {
    setError(null);
    const p = d.plan;
    if (!p) return;
    const bad = p.beats.findIndex((b) => b.source === "mine" && !d.clips[b.clip ?? 0]);
    if (bad >= 0) return setError(`Line ${bad + 1} is set to My clip, but that clip is missing. Upload it again or pick another shot.`);
    const empty = p.beats.findIndex((b) => b.source !== "stock" && b.source !== "mine" && b.visual.trim().length < 4);
    if (empty >= 0) return setError(`Say what we see on line ${empty + 1}.`);
    const safe = checkPrompt([p.look, ...p.beats.map((b) => b.visual)].join(". "));
    if (!safe.ok) return setError(safe.reason ?? "Some of these words can't be used.");
    if (d.voice.kind === "eleven" && !ownVoices.some((v) => `el:${v.id}` === (d.voice as { voice: string }).voice)) return setError("That ElevenLabs voice isn't connected in this browser. Pick one of our voices, or connect it in the Brand kit.");
    if (d.voice.kind === "recording" && mode === "live" && d.voice.url.startsWith("blob:")) return setError("Please upload your recording again.");
    const refs = d.star === "kit" ? kitRefs.slice(0, 4) : characterRefs(characters.filter((c) => c.id === d.star));
    const job = newScriptJob({
      plan: p,
      aspectRatio: d.shape,
      voice: d.voice,
      language,
      captions: d.captions,
      music: d.music,
      clips: d.clips,
      refs: refs.map(({ url, kind, token }) => ({ url, kind, token })),
    });
    const err = onStart(job);
    if (err) setError(err);
  }

  const beats = d.plan?.beats ?? [];
  const shown = showAll ? beats : beats.slice(0, SHOWN);
  const counts = beats.reduce((m, b) => ({ ...m, [b.source]: (m[b.source] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="guided script-set" aria-label={SCRIPT_NAME}>
      <div className="guided-head">
        <span className="film-badge">📜 {SCRIPT_NAME}</span>
        <h1>
          Your script, <em>turned into a video</em>
        </h1>
        <p className="muted">Paste your script, any length. Every word is kept exactly. You see each line beside the shot planned under it, and the price, before anything is made.</p>
      </div>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">1</span>
          <h2>Your script</h2>
          <span className="step-opt">{lines.length ? `${lines.length} lines · about ${formatLength(seconds)}` : "any length"}</span>
        </div>
        {d.plan ? (
          <>
            <p className="muted small">Your words are locked in while you plan the shots, so nothing changes by accident.</p>
            <button className="link-btn" onClick={() => set({ plan: null })}>
              Change the script
            </button>
          </>
        ) : (
          <textarea
            className="prompt script-text"
            placeholder="Paste your script here. A blank line starts a new paragraph."
            value={d.script}
            maxLength={30000}
            onChange={(e) => set({ script: e.target.value })}
          />
        )}
        <div className="sub-label">Shape</div>
        <div className="pills">
          {(["16:9", "9:16", "1:1"] as AspectRatio[]).map((a) => (
            <button key={a} className={d.shape === a ? "pill active" : "pill"} onClick={() => set({ shape: a, plan: d.plan ? { ...d.plan, beats: d.plan.beats.map((b) => ({ ...b, stock: undefined, stockTried: undefined })) } : null })}>
              {a === "16:9" ? "Wide 16:9 · YouTube" : a === "9:16" ? "Tall 9:16 · TikTok, Reels" : "Square 1:1 · Feed"}
            </button>
          ))}
        </div>
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">2</span>
          <h2>Pick a look</h2>
          <span className="step-opt">price first, change any line later</span>
        </div>
        <div className="script-looks" role="radiogroup" aria-label="Look">
          {LOOKS.map((l) => {
            const r: [number, number] = d.plan ? range(scriptCost(applyLook(d.plan, l.id, stockOn), extras)) : lookRange(lines, l.id, extras, stockOn);
            return (
              <button key={l.id} role="radio" aria-checked={d.look === l.id} className={d.look === l.id ? "script-look on" : "script-look"} onClick={() => pickLook(l.id)}>
                <strong>{l.label}</strong>
                <span className="script-look-price">{lines.length ? (mode === "demo" ? `Free in demo · live est. ${formatRange(r)}` : `est. ${formatRange(r)}`) : "Paste your script to see the price"}</span>
                <span className="muted small">{l.hint}</span>
              </button>
            );
          })}
        </div>
        {!stockOn && (
          <p className="muted small g-hint">
            {stockKeys.on ? "Stock video is only for wide 16:9 videos for now" : "Stock video isn't switched on yet"}, so lines that would use stock get an AI still with a slow move instead.
          </p>
        )}
        <div className="sub-label">Star of the video</div>
        <div className="pills">
          <button className={d.star === "" ? "pill active" : "pill"} onClick={() => set({ star: "" })}>
            No one in particular
          </button>
          {kitRefs.length > 0 && (
            <button className={d.star === "kit" ? "pill active" : "pill"} onClick={() => set({ star: "kit" })}>
              My brand kit pictures
            </button>
          )}
          {characters.map((c) => (
            <button key={c.id} className={d.star === c.id ? "pill active" : "pill"} onClick={() => set({ star: c.id })}>
              {c.name}
            </button>
          ))}
        </div>
        <p className="muted small">The star is kept the same in every AI shot. Make saved characters in Film Set.</p>
        {!d.plan && (
          <div className="generate-bar">
            <button className="generate" onClick={plan} disabled={!!busy || mode === "locked" || !lines.length}>
              <span className="generate-label">🗒️ Plan my shots</span>
              <span className="generate-cost">{mode === "demo" ? "Free" : "under 1 cent"}</span>
            </button>
          </div>
        )}
      </section>

      {d.plan && (
        <section className="g-step">
          <div className="g-head">
            <span className="g-num">3</span>
            <h2>Every line and its shot</h2>
            <span className="step-opt">
              {Object.entries(counts)
                .map(([k, v]) => `${v} ${SOURCE_LABEL[k as ShotSource]}`)
                .join(" · ")}
            </span>
          </div>
          <p className="muted small">Change what we see, or swap any shot between AI video, stock, an AI still and your own clip. The words on the left are yours and are never changed.</p>
          <label className="sub-label" htmlFor="script-look">
            Kept the same in every AI shot
          </label>
          <input id="script-look" className="text-input" maxLength={400} value={d.plan.look} onChange={(e) => set({ plan: { ...d.plan!, look: e.target.value } })} />
          <div className="script-rows">
            {shown.map((b, i) => (
              <div key={i} className="script-row">
                <div className="script-line">
                  <span className="script-num">{i + 1}</span>
                  <p>{b.text}</p>
                  <span className="muted small">{beatSeconds(b.text).toFixed(1)}s</span>
                </div>
                <div className="script-shot">
                  <div className="pills script-sources" role="radiogroup" aria-label={`Shot for line ${i + 1}`}>
                    {(["ai", "stock", "still", "mine"] as ShotSource[]).map((s) => (
                      <button key={s} role="radio" aria-checked={b.source === s} title={SOURCE_HINT[s]} className={b.source === s ? "pill active" : "pill"} onClick={() => swap(i, s)}>
                        {SOURCE_LABEL[s]}
                      </button>
                    ))}
                    <span className="muted small script-cost">{mode === "demo" ? "Free" : shotCost(b.source === "stock" && !b.stock ? "still" : b.source, beatSeconds(b.text)) === 0 ? "free" : `est. ${formatRange(range(shotCost(b.source === "stock" && !b.stock ? "still" : b.source, beatSeconds(b.text))))}`}</span>
                  </div>
                  {b.source === "mine" ? (
                    <div className="script-mine">
                      <select className="text-input" value={b.clip ?? 0} onChange={(e) => editBeat(i, { clip: Number(e.target.value) })} aria-label={`Your clip for line ${i + 1}`}>
                        {d.clips.map((c, k) => (
                          <option key={k} value={k}>
                            {c.name} · {c.seconds}s
                          </option>
                        ))}
                      </select>
                      {d.voice.kind !== "recording" && (
                        <label className="refs-consent">
                          <input type="checkbox" checked={Boolean(b.keepSound)} onChange={(e) => editBeat(i, { keepSound: e.target.checked })} />
                          <span>Keep the clip&apos;s own sound (the line isn&apos;t read over it)</span>
                        </label>
                      )}
                    </div>
                  ) : b.source === "stock" ? (
                    b.stock ? (
                      <div className="script-stock">
                        {b.stock.thumb && <img src={b.stock.thumb} alt="" loading="lazy" />}
                        <span className="small">
                          Video by{" "}
                          <a href={b.stock.page} target="_blank" rel="noreferrer">
                            {b.stock.by} on {b.stock.provider === "pexels" ? "Pexels" : "Pixabay"}
                          </a>
                        </span>
                        <button className="link-btn" onClick={() => nextStock(i)}>
                          Try another
                        </button>
                      </div>
                    ) : (
                      <p className="muted small">{b.stockTried || !stockOn ? "No stock video fits this line, so it becomes an AI still with a slow move." : "Finding a stock video..."}</p>
                    )
                  ) : null}
                  {b.source !== "mine" && (
                    <textarea className="text-input script-visual" maxLength={400} aria-label={`What we see on line ${i + 1}`} value={b.visual} onChange={(e) => editBeat(i, { visual: e.target.value })} />
                  )}
                  {b.source === "stock" && (
                    <input
                      className="text-input small"
                      aria-label={`Stock search for line ${i + 1}`}
                      value={b.search}
                      maxLength={60}
                      onChange={(e) => editBeat(i, { search: e.target.value, stock: undefined })}
                      onBlur={() => findStock()}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          {beats.length > SHOWN && (
            <button className="pill" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer lines" : `Show all ${beats.length} lines`}
            </button>
          )}
          {stockOn && <p className="muted small g-hint">Stock videos from {stockKeys.wideOnly ? "Pixabay (https://pixabay.com)" : "Pixabay (https://pixabay.com) and Pexels (https://www.pexels.com)"}, free to use in your videos.</p>}
        </section>
      )}

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">{d.plan ? 4 : 3}</span>
          <h2>Your own clips</h2>
          <span className="step-opt">optional · up to {MAX_CLIPS}</span>
        </div>
        <p className="muted small">Have your own footage? Upload it, pick &quot;My clip&quot; on any line, and AI and stock fill the gaps around it.</p>
        <label className="refs-consent">
          <input type="checkbox" checked={clipConsent} onChange={(e) => setClipConsent(e.target.checked)} />
          <span>These are my clips, or I have the rights to use them, and anyone in them agreed.</span>
        </label>
        <input type="file" accept="video/mp4,video/quicktime,video/webm" multiple disabled={!!busy || mode === "locked"} onChange={(e) => addClips(e.target.files)} />
        {d.clips.length > 0 && (
          <ul className="script-clips">
            {d.clips.map((c, k) => (
              <li key={k}>
                🎞️ {c.name} · {c.seconds}s{" "}
                <button className="link-btn" onClick={() => removeClip(k)} aria-label={`Remove ${c.name}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {d.plan && d.clips.length > 0 && (
          <button className="pill" onClick={spreadClips}>
            Spread my clips through the video
          </button>
        )}
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">{d.plan ? 5 : 4}</span>
          <h2>Voice, captions and music</h2>
        </div>
        <div className="sub-label">Who reads the script</div>
        <div className="pills">
          {AD_VOICES.map((v) => (
            <button key={v.id} className={d.voice.kind === "stock" && d.voice.voice === v.id ? "pill active" : "pill"} onClick={() => set({ voice: { kind: "stock", voice: v.id } })}>
              {v.label}
            </button>
          ))}
          {ownVoices.map((v) => (
            <button key={v.id} className={d.voice.kind === "eleven" && d.voice.voice === `el:${v.id}` ? "pill active" : "pill"} onClick={() => set({ voice: { kind: "eleven", voice: `el:${v.id}` } })}>
              🎙️ {v.name} (your ElevenLabs)
            </button>
          ))}
          <button className={d.voice.kind === "recording" ? "pill active" : "pill"} onClick={() => setError(d.voice.kind === "recording" ? null : "Upload your recording below to use your own voice.")}>
            🎤 My own recording
          </button>
        </div>
        {!ownVoices.length && <p className="muted small">Have an ElevenLabs voice? Connect it in the Brand kit and it shows up here.</p>}
        <details className="film-how" open={d.voice.kind === "recording"}>
          <summary>{d.voice.kind === "recording" ? `Your recording: ${d.voice.name} · ${formatLength(d.voice.seconds)}` : "Use my own recording of the script"}</summary>
          <p className="muted small">Record yourself reading the script, then upload it. We line up each shot with the words you say.</p>
          <label className="refs-consent">
            <input type="checkbox" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} />
            <span>This is my own voice, or I have permission to use it.</span>
          </label>
          <input type="file" accept="audio/*" disabled={!!busy || mode === "locked"} onChange={(e) => addRecording(e.target.files)} />
        </details>
        <label className="refs-consent">
          <input type="checkbox" checked={d.captions} onChange={(e) => set({ captions: e.target.checked })} />
          <span>Captions on the video (you also get a free captions file for YouTube and TikTok)</span>
        </label>
        <label className="refs-consent">
          <input type="checkbox" checked={d.music} onChange={(e) => set({ music: e.target.checked })} />
          <span>Quiet background music</span>
        </label>
        {d.music && d.plan && <input className="text-input" maxLength={200} aria-label="Music style" value={d.plan.music} onChange={(e) => set({ plan: { ...d.plan!, music: e.target.value } })} />}
      </section>

      {d.plan && (
        <>
          <div className="generate-bar">
            <button className="generate" onClick={go} disabled={mode === "locked" || !!busy}>
              <span className="generate-label">🎬 Make my video</span>
              <span className="generate-cost">{price(range(cost))}</span>
            </button>
          </div>
          <p className="muted small g-hint">
            {mode === "demo" ? `Free in demo mode (live estimate ${formatRange(range(cost))}). ` : ""}
            About {formatLength(seconds)} long. Takes about {buildMinutes(beats)} minutes; you can close the page and come back. Failed shots never use your credits. {COST_NOTE}
          </p>
        </>
      )}
      {busy && <p className="muted small" aria-live="polite">{busy}</p>}
      {error && <p className="notice warn">{error}</p>}
    </div>
  );
}
