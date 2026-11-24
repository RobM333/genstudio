"use client";

// "You, talking": set up your voice and photo once, then type what to say and
// get a video of yourself saying it in your own voice.
// The voice copy and the photo are kept in this browser, and in the person's
// account when they are signed in (accounts on).

import { useEffect, useRef, useState } from "react";
import type { AppMode } from "@/lib/config";
import { AD_LANGUAGES } from "@/lib/adplan";
import { formatCost } from "@/lib/models";
import { creditsFor } from "@/lib/pricing";
import {
  consentSentence,
  MAX_RECORD_SECONDS,
  MAX_TALK_CHARS,
  MAX_TALK_SECONDS,
  MIN_RECORD_SECONDS,
  READING_SCRIPT,
  SAMPLE_LINE,
  setupCost,
  talkCost,
  talkSeconds,
  TALK_SPEECH_MODEL_ID,
} from "@/lib/talk";
import { finishReference, shrink } from "./ReferencesBox";
import { post, waitForResult } from "./storyRunner";
import { useAccount } from "./account/Account";

export type TalkVoice = { id: string; token: string; sampleUrl?: string; at: number };
export type TalkPhoto = { url: string; token: string; shape?: "1:1" | "16:9" | "9:16" }; // the video keeps the photo's shape
export type TalkSetup = { voice?: TalkVoice; photo?: TalkPhoto };

const STORE = "genstudio.talk.v1";

export function loadTalk(): TalkSetup {
  try {
    const raw = localStorage.getItem(STORE);
    const t = raw ? (JSON.parse(raw) as TalkSetup) : null;
    if (t && typeof t === "object")
      return {
        voice: t.voice && t.voice.id && t.voice.token ? t.voice : undefined,
        photo: t.photo && t.photo.url && t.photo.token ? t.photo : undefined,
      };
  } catch {
    // nothing saved, or storage blocked
  }
  return {};
}

export function saveTalk(t: TalkSetup) {
  try {
    localStorage.setItem(STORE, JSON.stringify(t));
  } catch {
    // storage full or blocked: the setup just won't be remembered
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turns any browser recording into a mono 24 kHz WAV file, which the voice copy accepts. */
async function toWav(blob: Blob): Promise<Blob> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close().catch(() => {});
  const rate = 24000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Records the voice once: the consent sentence with a fresh code, then a short passage. */
export function VoiceSetup({ mode, onDone, onCancel }: { mode: AppMode; onDone: (v: TalkVoice) => void; onCancel?: () => void }) {
  const [code, setCode] = useState<{ code: string; ts: string; codeToken: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipUrl = clip ? URL.createObjectURL(clip) : "";

  useEffect(() => {
    fetch("/api/talk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "code" }) })
      .then((r) => r.json())
      .then((d) => d.code && setCode(d))
      .catch(() => setError("Couldn't get your code. Please reload the page."));
    return () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setError(null);
    setClip(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream);
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setClip(new Blob(parts, { type: r.mimeType || "audio/webm" }));
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setRecording(true);
      const began = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_RECORD_SECONDS) stop();
      }, 250);
    } catch {
      setError("We couldn't use your microphone. Allow microphone access in your browser and try again.");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    if (rec.current?.state === "recording") rec.current.stop();
  }

  async function send() {
    if (!clip || !code) return;
    setError(null);
    if (!consent) return setError("Please tick the box first.");
    if (seconds < MIN_RECORD_SECONDS) return setError(`Please record at least ${MIN_RECORD_SECONDS} seconds, so the copy sounds like you.`);
    try {
      setBusy("Getting the recording ready...");
      const wav = await toWav(clip);
      const form = new FormData();
      form.append("file", wav, "voice.wav");
      form.append("code", code.code);
      form.append("ts", code.ts);
      form.append("codeToken", code.codeToken);
      form.append("consent", "yes");
      setBusy("Uploading...");
      const res = await fetch("/api/talk", { method: "POST", body: form });
      let d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Upload failed.");
      if (d.status !== "COMPLETED") {
        setBusy("Checking your consent sentence...");
        const q = new URLSearchParams({ step: "consent", requestId: d.requestId, audioUrl: d.audioUrl, code: d.code, checkToken: d.checkToken });
        for (let i = 0; ; i++) {
          if (i > 60) throw new Error("The check took too long. Please try again.");
          await sleep(2500);
          const r = await fetch(`/api/talk?${q}`);
          d = await r.json().catch(() => ({}));
          if (!r.ok || d.status === "REJECTED" || d.status === "FAILED") throw new Error(d.error ?? "The check didn't work.");
          if (d.status === "COPYING") break;
        }
        setBusy("Making the copy of your voice...");
        const c = new URLSearchParams({ step: "clone", requestId: d.requestId, cloneToken: d.cloneToken });
        for (let i = 0; ; i++) {
          if (i > 90) throw new Error("The voice copy took too long. Please try again.");
          await sleep(3000);
          const r = await fetch(`/api/talk?${c}`);
          d = await r.json().catch(() => ({}));
          if (!r.ok || d.status === "FAILED") throw new Error(d.error ?? "The voice copy didn't work.");
          if (d.status === "COMPLETED") break;
        }
      }
      // A short sample, so they can hear it. Using the copy straight away also keeps it from expiring.
      setBusy("Saying hello in your new voice...");
      let sampleUrl: string | undefined;
      try {
        const s = await post("/api/talk", { action: "speak", text: SAMPLE_LINE, voiceId: d.voiceId, voiceToken: d.voiceToken, language: "English" });
        const out = await waitForResult(TALK_SPEECH_MODEL_ID, s);
        sampleUrl = out.url !== "demo" ? out.url : undefined;
      } catch {
        // the sample is a nice extra; the voice is ready without it
      }
      onDone({ id: d.voiceId, token: d.voiceToken, sampleUrl, at: Date.now() });
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="talk-setup">
      <p className="muted small">
        Read this out loud in a quiet room, in your normal voice. It takes about a minute. Start with the first sentence exactly as written: it shows this is
        your own voice and that you agree to the copy.
      </p>
      <blockquote className="talk-consent">{code ? consentSentence(code.code) : "Getting your code..."}</blockquote>
      <blockquote className="talk-script">{READING_SCRIPT}</blockquote>
      <div className="talk-rec">
        {recording ? (
          <button className="btn btn-light" onClick={stop}>
            ■ Stop ({seconds}s)
          </button>
        ) : (
          <button className="btn btn-light" onClick={start} disabled={!code || !!busy || mode === "locked"}>
            🎙️ {clip ? "Record again" : "Start recording"}
          </button>
        )}
        {recording && <span className={seconds >= MIN_RECORD_SECONDS ? "small" : "muted small"}>{seconds < MIN_RECORD_SECONDS ? `Keep going, at least ${MIN_RECORD_SECONDS}s` : "Great, stop when you finish reading"}</span>}
        {onCancel && !recording && (
          <button className="link-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {clip && !recording && (
        <>
          <audio src={clipUrl} controls className="talk-audio" />
          <label className="refs-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>This is my own voice. I agree to ToastyFly making a copy of it that only I use, and I won&apos;t use it to pretend to be anyone else.</span>
          </label>
          <button className="btn btn-light" onClick={send} disabled={!!busy}>
            {busy ?? `Make my voice copy · ${mode === "demo" ? "free in demo" : `est. ${formatCost(setupCost())}`}`}
          </button>
          {mode !== "demo" && <p className="muted small">One time only, about {creditsFor(setupCost())} credits. If the check or the copy fails, it uses none.</p>}
        </>
      )}
      {error && <p className="notice warn small-notice">{error}</p>}
    </div>
  );
}

/** The user's own photo, checked like every person picture, plus a "this is me" tick. */
export function PhotoSetup({ mode, onDone }: { mode: AppMode; onDone: (p: TalkPhoto) => void }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("Please use a PNG, JPG or WebP photo.");
    try {
      setBusy("Uploading...");
      const form = new FormData();
      form.append("file", await shrink(file, false), file.name);
      form.append("kind", "person");
      form.append("consent", "yes");
      const res = await fetch("/api/reference", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      if (data.status !== "COMPLETED") setBusy("Checking the photo...");
      const done = await finishReference(data, "person");
      const dims = await createImageBitmap(file).then((b) => b.width / b.height).catch(() => 1);
      onDone({ ...done, shape: dims > 1.25 ? "16:9" : dims < 0.8 ? "9:16" : "1:1" });
    } catch (e) {
      setError((e as Error).message || "Upload failed.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="talk-setup">
      <p className="muted small">A clear, well-lit photo of you looking at the camera, head and shoulders, on your own. The video keeps its shape.</p>
      <label className="refs-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>This is a photo of me, the same person whose voice I recorded. I&apos;m an adult.</span>
      </label>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <button className="btn" disabled={!!busy || mode === "locked"} onClick={() => (consent ? input.current?.click() : setError("Please tick the box first."))}>
        {busy ?? "＋ Add my photo"}
      </button>
      {error && <p className="notice warn small-notice">{error}</p>}
    </div>
  );
}

/** The Create form for a talking video: your voice and face, what to say, then make it. */
export function TalkForm({
  mode,
  setup,
  onSetup,
  text,
  onText,
  language,
  onLanguage,
  onGenerate,
  error,
}: {
  mode: AppMode;
  setup: TalkSetup;
  onSetup: (t: TalkSetup) => void;
  text: string;
  onText: (t: string) => void;
  language: string;
  onLanguage: (l: string) => void;
  onGenerate: () => void;
  error?: string | null;
}) {
  const [redoVoice, setRedoVoice] = useState(false);
  const [redoPhoto, setRedoPhoto] = useState(false);
  const ready = Boolean(setup.voice && setup.photo);
  const secs = talkSeconds(text, language);
  const tooLong = secs > MAX_TALK_SECONDS;
  const cost = talkCost(Math.max(secs, 5), text.length);

  return (
    <>
      <section className="g-step">
        <div className="g-head">
          <span className="g-num">2</span>
          <h2>Your voice and face</h2>
          <span className="step-opt">set up once</span>
        </div>
        <div className="talk-part">
          <strong>🎙️ Your voice</strong>
          {setup.voice && !redoVoice ? (
            <div className="talk-ready">
              <span>✓ Ready</span>
              {setup.voice.sampleUrl && <audio src={setup.voice.sampleUrl} controls className="talk-audio" />}
              <button className="link-btn" onClick={() => setRedoVoice(true)}>
                Record again
              </button>
              <DeleteVoice onDeleted={() => onSetup({ ...setup, voice: undefined })} />
            </div>
          ) : (
            <VoiceSetup
              mode={mode}
              onCancel={setup.voice ? () => setRedoVoice(false) : undefined}
              onDone={(voice) => {
                setRedoVoice(false);
                onSetup({ ...setup, voice });
              }}
            />
          )}
        </div>
        <div className="talk-part">
          <strong>🙂 Your photo</strong>
          {setup.photo && !redoPhoto ? (
            <div className="talk-ready">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.photo.url} alt="Your photo" className="talk-photo" />
              <span>✓ Ready</span>
              <button className="link-btn" onClick={() => setRedoPhoto(true)}>
                Change photo
              </button>
            </div>
          ) : (
            <PhotoSetup
              mode={mode}
              onDone={(photo) => {
                setRedoPhoto(false);
                onSetup({ ...setup, photo });
              }}
            />
          )}
        </div>
        <p className="muted small g-hint">
          Only your own voice and face. Your voice copy and photo are kept in this browser, so on another device you set them up again.
        </p>
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">3</span>
          <h2>What should you say?</h2>
        </div>
        <textarea
          id="talk-text"
          className="prompt"
          rows={4}
          maxLength={MAX_TALK_CHARS}
          placeholder="e.g. Hi, I'm Sam from Glow Candles. Our new winter range is here: three cosy scents, hand-poured in small batches. Order by Friday for free delivery."
          value={text}
          onChange={(e) => onText(e.target.value)}
        />
        <div className="talk-meta">
          <label className="sub-label" htmlFor="talk-lang">
            Language
          </label>
          <select id="talk-lang" className="text-input" value={language} onChange={(e) => onLanguage(e.target.value)}>
            {AD_LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          {text.trim() && (
            <span className={tooLong ? "notice warn small-notice" : "muted small"}>
              {tooLong ? `That's about ${secs} seconds. Please keep it under ${MAX_TALK_SECONDS}.` : `About ${secs} seconds of talking.`}
            </span>
          )}
        </div>
        <p className="muted small g-hint">Write it in the language you pick. Your voice speaks it, even if you recorded in English.</p>
      </section>

      <section className="g-step g-go">
        <div className="g-head">
          <span className="g-num">4</span>
          <h2>Generate</h2>
        </div>
        <button className="generate" onClick={onGenerate} disabled={mode === "locked" || !ready || !text.trim() || tooLong}>
          <span>{ready ? "Make my talking video" : "Set up your voice and photo first"}</span>
          <span className="generate-cost">{mode === "demo" ? "Free" : `est. ${formatCost(cost)}`}</span>
        </button>
        {error && <p className="error">{error}</p>}
        <p className="muted small">It can take several minutes. If it fails, it uses no credits.</p>
      </section>
    </>
  );
}

/** Deletes the voice copy: from the account (so it can never be used again) when signed in, and from this browser. */
function DeleteVoice({ onDeleted }: { onDeleted: () => void }) {
  const account = useAccount();
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ask)
    return (
      <button className="link-btn" onClick={() => setAsk(true)}>
        Delete my voice copy
      </button>
    );
  return (
    <span className="talk-delete">
      Delete your voice copy for good?{" "}
      <button
        className="link-btn"
        onClick={async () => {
          if (account) {
            const r = await fetch("/api/me/voice", { method: "DELETE" }).catch(() => null);
            if (!r?.ok) return setError("Couldn't delete it. Please try again.");
            account.refresh();
          }
          setAsk(false);
          onDeleted();
        }}
      >
        Yes, delete it
      </button>{" "}
      ·{" "}
      <button className="link-btn" onClick={() => setAsk(false)}>
        Keep it
      </button>
      {error && <span className="form-error"> {error}</span>}
    </span>
  );
}
