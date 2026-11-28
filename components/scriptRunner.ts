// Builds a Script to Video in the browser, one short fal job at a time, so
// nothing hits the hosting time limit and a 10-minute video is fine:
//   1. the voice: each line read by our voice or the person's ElevenLabs voice
//      (or their own recording, lined up with the lines), so every shot lasts
//      exactly as long as its line
//   2. the shots, three at a time: AI video, free stock video, AI stills with a
//      slow move, or the person's own clips
//   3. the shots joined in sections of 12, then the sections joined
//   4. the voice, music (one bed repeated) and kept clip sound mixed in
//   5. captions, if asked for
// Progress is saved on the item after every step, so a closed page carries on
// where it stopped and nothing already made is paid for again.

import { post, waitFor } from "./storyRunner";
import { AD_I2V } from "./adRunner";
import { loadEleven, speakOwn, usableVoices } from "./elevenConnect";
import { alignRecording, beatSeconds, partKey, SECTION_SIZE, shotPrompt, stillMove, wordTimings, type ScriptJob } from "@/lib/script";
import { CAPTIONS_MODEL, CARD_MOTION_MODEL, COMPOSE_MODEL, MERGE_AUDIO_MODEL, MERGE_VIDEOS_MODEL, MUSIC_MODEL, TRANSCRIBE_MODEL, VOICE_MODEL } from "@/lib/models";

const AT_ONCE = 3;

/** How long a sound or video file lasts, read by the browser (free). Unknown gives null. */
export function mediaSeconds(url: string, kind: "audio" | "video" = "audio"): Promise<number | null> {
  if (typeof document === "undefined" || !url || url.startsWith("data:image")) return Promise.resolve(null);
  return new Promise((ok) => {
    const el = document.createElement(kind);
    const done = (v: number | null) => {
      el.removeAttribute("src");
      ok(v);
    };
    const t = setTimeout(() => done(null), 15000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      clearTimeout(t);
      done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    };
    el.onerror = () => {
      clearTimeout(t);
      done(null);
    };
    el.src = url;
  });
}

async function tool(body: Record<string, unknown>, fallbackModel: string): Promise<string> {
  const res = await post("/api/tool", body);
  if (res.status === "COMPLETED") return res.url ?? "";
  return waitFor(res.modelId ?? fallbackModel, res);
}

/** Runs the work a few at a time; the first failure is thrown once the running ones finish. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (next < items.length && !failed) {
      const x = items[next++];
      try {
        await fn(x);
      } catch (e) {
        failed ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failed) throw failed;
}

/** Joins files in groups the joiner can take, then joins the groups, until one is left. */
async function joinAll(urls: string[], group: number, join: (part: string[]) => Promise<string>): Promise<string> {
  let list = urls;
  while (list.length > 1) {
    const out: string[] = [];
    for (let i = 0; i < list.length; i += group) {
      const part = list.slice(i, i + group);
      out.push(part.length === 1 ? part[0] : await join(part));
    }
    list = out;
  }
  return list[0];
}

/** The transcription of the person's own recording: words with their times. */
async function transcribe(audioUrl: string, seconds: number, language: string): Promise<{ text: string; start: number }[]> {
  const res = await post("/api/tool", { tool: "transcribe", audioUrl, seconds, language });
  if (!res.requestId) return [];
  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await fetch(`/api/status?modelId=${encodeURIComponent(TRANSCRIBE_MODEL.id)}&requestId=${encodeURIComponent(res.requestId)}`);
    const data = (await r.json().catch(() => ({}))) as { status?: string; chunks?: unknown; error?: string };
    if (data.status === "COMPLETED") return wordTimings(data.chunks);
    if (data.status === "FAILED" || !r.ok) throw new Error(data.error ?? "We couldn't hear your recording. Please try again.");
  }
  throw new Error("Lining up your recording took too long. Please try again.");
}

export type ScriptOut = { url: string; lengths: number[] };

export async function buildScript(job: ScriptJob, save: (j: ScriptJob, stepChanged?: boolean) => void, opts: { live: boolean }): Promise<ScriptOut> {
  const beats = job.plan.beats;
  const n = beats.length;
  let lastStep = "";
  const step = (label: string) => {
    job.step = label;
    save(job, label !== lastStep);
    lastStep = label;
  };
  const keeps = (i: number) => beats[i].source === "mine" && Boolean(beats[i].keepSound) && job.voice.kind !== "recording";
  const clipSeconds = (i: number) => job.clips[beats[i].clip ?? 0]?.seconds || beatSeconds(beats[i].text);

  // ---------- 1. the voice, which sets how long every shot lasts ----------
  if (job.voice.kind === "recording") {
    const rec = job.voice;
    if (job.lengths.length !== n || job.lengths.some((l) => !l)) {
      let lengths: number[];
      if (opts.live) {
        step("Listening to your recording to line up each shot with its words");
        const words = await transcribe(rec.url, rec.seconds, job.language);
        lengths = alignRecording(beats.map((b) => b.text), words, rec.seconds);
      } else {
        const guess = beats.map((b) => beatSeconds(b.text));
        const k = rec.seconds / guess.reduce((a, b) => a + b, 0);
        lengths = guess.map((g) => g * k);
      }
      job.lengths = lengths;
      save(job);
    }
  } else {
    const own = job.voice.kind === "eleven";
    const voiceId = job.voice.voice;
    const conn = own && opts.live ? loadEleven() : null;
    if (own && opts.live && !usableVoices(conn).some((v) => `el:${v.id}` === voiceId))
      throw new Error("This video uses your ElevenLabs voice, but that voice isn't connected in this browser. Connect it in the Brand kit, or pick one of our voices.");
    let done = 0;
    const todo = beats.map((_, i) => i).filter((i) => !keeps(i));
    await pool(todo, AT_ONCE, async (i) => {
      const key = `${voiceId}|${beats[i].text}`;
      if (job.voices[i] && job.voiceFor[i] === key && job.lengths[i]) {
        done++;
        return;
      }
      step(`Recording the voice (${Math.min(done + 1, todo.length)} of ${todo.length} lines)`);
      if (opts.live) {
        job.voices[i] = (own ? await speakOwn(conn!, voiceId, beats[i].text, job.language) : await tool({ tool: "voice", text: beats[i].text, voice: voiceId }, VOICE_MODEL.id)) || undefined;
        job.lengths[i] = (job.voices[i] ? await mediaSeconds(job.voices[i]!) : null) ?? beatSeconds(beats[i].text);
      } else job.lengths[i] = beatSeconds(beats[i].text);
      job.voiceFor[i] = key;
      done++;
      save(job);
    });
    // A clip that keeps its own sound lasts as long as the clip.
    for (let i = 0; i < n; i++) if (keeps(i)) job.lengths[i] = Math.min(20, clipSeconds(i));
  }
  const lengths = beats.map((b, i) => Math.max(0.5, job.lengths[i] ?? beatSeconds(b.text)));
  const total = lengths.reduce((a, b) => a + b, 0);

  // ---------- 2. the shots ----------
  const refs = job.refs?.length ? job.refs : undefined;
  async function frame(i: number, still: boolean): Promise<string> {
    const modelId = refs ? "fal-ai/nano-banana/edit" : "fal-ai/nano-banana";
    const res = await post("/api/generate", { modelId, prompt: shotPrompt(job.plan, beats[i], still), aspectRatio: job.aspectRatio, enhance: false, purpose: refs ? "keyframe" : undefined, refs });
    return waitFor(res.modelId ?? modelId, res);
  }
  let made = 0;
  await pool(
    beats.map((_, i) => i),
    AT_ONCE,
    async (i) => {
      const b = beats[i];
      const part = job.parts[i] ?? (job.parts[i] = { status: "waiting" });
      const key = partKey(job, i, lengths[i]);
      if (part.url && part.madeFor === key) {
        made++;
        return;
      }
      const label = `Shot ${made + 1} of ${n}`;
      part.status = "working";
      part.error = undefined;
      try {
        // A stock line with no stock video found becomes a still with a slow move.
        const source = b.source === "stock" && !b.stock ? "still" : b.source;
        if (source === "stock") part.url = b.stock!.url;
        else if (source === "mine") {
          const c = job.clips[b.clip ?? 0];
          if (!c) throw new Error(`Line ${i + 1} uses one of your clips, but that clip is missing. Pick another clip or another kind of shot.`);
          part.url = c.url;
        } else {
          const frameKey = `${source}|${b.visual}|${job.plan.look}`;
          if (!part.frame || part.frameFor !== frameKey) {
            step(`${label}: ${source === "ai" ? "setting up the shot" : "making the picture"}`);
            part.frame = await frame(i, source === "still");
            part.frameFor = frameKey;
            save(job);
          }
          if (source === "ai") {
            step(`${label}: filming it`);
            const res = await post("/api/generate", { modelId: AD_I2V, prompt: shotPrompt(job.plan, b), aspectRatio: job.aspectRatio, duration: lengths[i] > 5 ? 10 : 5, sound: false, enhance: true, noText: true, sourceUrl: part.frame, purpose: "animate" });
            part.url = await waitFor(res.modelId ?? AD_I2V, res);
          } else {
            step(`${label}: adding a slow move`);
            part.url = await tool({ tool: "still-move", imageUrl: part.frame, prompt: stillMove(i), seconds: Math.min(10, lengths[i]) }, CARD_MOTION_MODEL.id);
          }
        }
        part.madeFor = key;
        part.status = "done";
        made++;
        save(job);
      } catch (e) {
        part.status = "failed";
        part.error = (e as Error).message;
        save(job);
        throw new Error(`Line ${i + 1}: ${(e as Error).message}`);
      }
    },
  );

  // ---------- 3. the shots joined: sections of 12, then the sections ----------
  const sections: string[] = [];
  const count = Math.ceil(n / SECTION_SIZE);
  job.sections ??= [];
  for (let s = 0; s < count; s++) {
    const idx = beats.map((_, i) => i).slice(s * SECTION_SIZE, (s + 1) * SECTION_SIZE);
    const urls = idx.map((i) => job.parts[i].url!);
    const durations = idx.map((i) => Math.round(lengths[i] * 100) / 100);
    const key = `${urls.join(",")}|${durations.join(",")}`;
    if (job.sections[s]?.for !== key) {
      step(`Joining the shots (part ${s + 1} of ${count})`);
      job.sections[s] = { url: await tool({ tool: "script-join", urls, durations }, COMPOSE_MODEL.id), for: key };
      job.mixedUrl = undefined;
      save(job);
    }
    sections.push(job.sections[s].url);
  }
  job.sections = job.sections.slice(0, count);
  const video = await joinAll(sections, 14, (part) => {
    step("Joining the parts into one video");
    return tool({ tool: "script-merge", urls: part }, MERGE_VIDEOS_MODEL.id);
  });

  // ---------- 4. voice, music and kept clip sound ----------
  const starts: number[] = [];
  lengths.reduce((at, l) => (starts.push(at), at + l), 0);
  let runs: { url: string; at: number; seconds: number }[] = [];
  if (job.voice.kind === "recording") runs = [{ url: job.voice.url, at: 0, seconds: total }];
  else if (opts.live) {
    // Lines in a row are joined into one track; a clip that keeps its own sound starts a new run.
    const groups: number[][] = [];
    for (let i = 0; i < n; i++) {
      if (keeps(i) || !job.voices[i]) continue;
      const g = groups[groups.length - 1];
      if (g && g[g.length - 1] === i - 1) g.push(i);
      else groups.push([i]);
    }
    for (const g of groups) {
      const urls = g.map((i) => job.voices[i]!);
      const key = urls.join(",");
      job.voiceRuns ??= {};
      if (urls.length > 1 && !job.voiceRuns[key]) {
        step("Joining the voice into one track");
        job.voiceRuns[key] = await joinAll(urls, 60, (part) => tool({ tool: "voice-join", audioUrls: part }, MERGE_AUDIO_MODEL.id));
        save(job);
      }
      const url = urls.length > 1 ? job.voiceRuns[key] : urls[0];
      runs.push({ url, at: starts[g[0]], seconds: g.reduce((t, i) => t + lengths[i], 0) });
    }
  }
  const keep = opts.live ? beats.map((_, i) => i).filter(keeps).map((i) => ({ url: job.parts[i].url!, at: starts[i], seconds: lengths[i] })) : [];

  if (job.music && opts.live && !job.musicUrl) {
    step("Making the music");
    job.musicUrl = (await tool({ tool: "music", prompt: job.plan.music, seconds: 60 }, MUSIC_MODEL.id)) || undefined;
    save(job);
  }

  const mixKey = `${video}|${JSON.stringify(runs)}|${JSON.stringify(keep)}|${job.music ? job.musicUrl : ""}`;
  if (!job.mixedUrl || job.mixedFor !== mixKey) {
    if (runs.length || keep.length || (job.music && job.musicUrl)) {
      step("Mixing the voice and music");
      job.mixedUrl = await tool({ tool: "script-mix", videoUrl: video, voices: runs, keep, musicUrl: job.music ? job.musicUrl : undefined, seconds: Math.round(total * 10) / 10 }, COMPOSE_MODEL.id);
    } else job.mixedUrl = video;
    job.mixedFor = mixKey;
    job.captionedUrl = undefined;
    save(job);
  }

  // ---------- 5. captions ----------
  let url = job.mixedUrl!;
  if (job.captions && opts.live) {
    if (!job.captionedUrl) {
      step("Adding captions");
      job.captionedUrl = await tool({ tool: "captions", videoUrl: url, seconds: Math.ceil(total), language: job.language }, CAPTIONS_MODEL.id);
      save(job);
    }
    url = job.captionedUrl;
  }
  job.step = undefined;
  return { url, lengths };
}
