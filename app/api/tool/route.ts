import { NextResponse } from "next/server";
import { getMode } from "@/lib/config";
import { fal } from "@/lib/fal";
import { checkPrompt } from "@/lib/safety";
import { AD_VOICES, DEFAULT_VOICE, lineSeconds, SCENE_AVOID } from "@/lib/adplan";
import { makeDemoMedia } from "@/lib/demo";
import { payForStep } from "@/lib/accounts/current";
import { toolUsd } from "@/lib/accounts/credits";
import { CAPTIONS_MODEL, CARD_MOTION_MODEL, COMPOSE_MODEL, isFalMediaUrl, isStockVideoUrl, MERGE_AUDIO_MODEL, TRIM_MODEL, TRANSCRIBE_MODEL, LAST_FRAME_MODEL, MERGE_VIDEOS_MODEL, MUSIC_MODEL, NATIVE_TALK_MODELS, TALK_VIDEO_MODEL, VOICE_MODEL } from "@/lib/models";
import { MAX_BEATS } from "@/lib/script";

export const dynamic = "force-dynamic";

// Small helpers for storyboards and full ads, each a short fal job (poll /api/status):
// - last-frame: grab a video's last frame so the next shot can continue from it
// - merge: join several videos into one
// - voice: read a voiceover line
// - music: make an instrumental music bed
// - card: turn the ad's end card picture into a short, nearly still video
// - mix: put a video, voiceover clips and music together
// - talk-scene: an ad scene said on screen: the scene's first frame speaks the
//   line already recorded, with the lips matched to that exact voice
// - talk-native: an ad scene said on screen in one step (Kling 3): the line is in
//   the prompt and the model makes the voice and the moving mouth together
// - join: joins scenes of different lengths on one timeline (used if merge can't)
// Script to Video (long videos):
// - script-join: places up to 14 shots (AI, stock, stills, the person's own clips) one after another, each cut to its line's length
// - script-merge: joins finished sections into one video
// - voice-join: joins the voiceover lines into one track
// - still-move: a still picture with a slow zoom or pan
// - script-mix: the whole video, its voice track, music repeated under it, and the sound of the person's own clips they kept
// - captions: burns captions into the finished video
// - transcribe: hears the person's own recording, with the time of every word
type Body = {
  audioUrls?: unknown;
  keep?: { url?: string; at?: number; seconds?: number }[];
  language?: string;
  tool?: string;
  urls?: unknown;
  url?: string;
  text?: string;
  voice?: string;
  prompt?: string;
  seconds?: number;
  imageUrl?: string;
  videoUrl?: string;
  voices?: { url?: string; at?: number; seconds?: number }[];
  musicUrl?: string;
  audioUrl?: string;
  durations?: unknown;
  aspectRatio?: string;
  model?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const mode = getMode();
  if (mode === "locked") return NextResponse.json({ error: "Real generation is switched off." }, { status: 403 });
  const urls = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 14) : [];
  const seconds = Math.max(1, Math.min(70, Number(body.seconds) || 5));

  let modelId: string;
  let input: Record<string, unknown>;
  let demoUrl = "";
  const allUrls: string[] = [];
  const stockUrls: string[] = []; // may also be free stock videos
  let scriptSeconds = 0;

  switch (body.tool) {
    case "last-frame":
    case "merge": {
      const tool = body.tool === "merge" ? MERGE_VIDEOS_MODEL : LAST_FRAME_MODEL;
      if (urls.length === 0 || (tool === LAST_FRAME_MODEL && urls.length !== 1)) return bad();
      modelId = tool.id;
      input = tool === LAST_FRAME_MODEL ? { video_url: urls[0], frame_type: "last" } : { video_urls: urls, resolution_aspect_ratio_video_index: 0 };
      allUrls.push(...urls);
      demoUrl = urls[urls.length - 1];
      break;
    }
    case "voice": {
      const text = String(body.text ?? "").trim().slice(0, 400);
      if (!text) return bad();
      if (!checkPrompt(text).ok) return NextResponse.json({ error: "This voiceover line can't be used." }, { status: 422 });
      const voice = AD_VOICES.some((v) => v.id === body.voice) ? String(body.voice) : DEFAULT_VOICE;
      modelId = VOICE_MODEL.id;
      input = { text, voice, stability: 0.5, similarity_boost: 0.75, speed: 1 };
      break;
    }
    case "music": {
      const prompt = String(body.prompt ?? "").trim().slice(0, 300);
      if (!prompt || !checkPrompt(prompt).ok) return bad();
      modelId = MUSIC_MODEL.id;
      input = { prompt: `${prompt}. Instrumental only, no vocals. A subtle background bed for a voiceover, gentle and not too loud.`, duration: Math.ceil(seconds) };
      break;
    }
    case "card": {
      // A picture on its own comes out of the mixer as a single frame, so the end card gets a gentle, nearly still move.
      const imageUrl = String(body.imageUrl ?? "");
      if (!imageUrl) return bad();
      modelId = CARD_MOTION_MODEL.id;
      input = {
        image_url: imageUrl,
        prompt: "A completely still product end card. Very slow, subtle push-in. The text stays perfectly still, sharp and readable. Nothing else moves.",
        negative_prompt: "moving text, warped letters, morphing, distorted, jittery, blurry, new objects",
        num_frames: Math.min(241, Math.round(seconds * 24) + 1),
        resolution: "720p",
        aspect_ratio: "auto",
      };
      allUrls.push(imageUrl);
      demoUrl = imageUrl;
      break;
    }
    case "mix": {
      const videoUrl = String(body.videoUrl ?? "");
      if (!videoUrl) return bad();
      const ms = Math.round(seconds * 1000);
      const voices = (Array.isArray(body.voices) ? body.voices : [])
        .filter((v) => v && typeof v.url === "string" && v.url)
        .slice(0, 14)
        .map((v) => ({ url: String(v.url), timestamp: Math.max(0, Math.round(Number(v.at) * 1000) || 0), duration: Math.max(500, Math.round(Number(v.seconds) * 1000) || 4000) }));
      const tracks: Record<string, unknown>[] = [{ id: "video", type: "video", keyframes: [{ url: videoUrl, timestamp: 0, duration: ms }] }];
      if (voices.length) tracks.push({ id: "voice", type: "audio", keyframes: voices });
      if (body.musicUrl) tracks.push({ id: "music", type: "audio", keyframes: [{ url: String(body.musicUrl), timestamp: 0, duration: ms }] });
      modelId = COMPOSE_MODEL.id;
      input = { tracks };
      allUrls.push(videoUrl, ...voices.map((v) => v.url), ...(body.musicUrl ? [String(body.musicUrl)] : []));
      demoUrl = videoUrl;
      break;
    }
    case "talk-scene": {
      // The line was recorded first; now the scene's opening picture says it, lips matched to the recording.
      const imageUrl = String(body.imageUrl ?? "");
      const audioUrl = String(body.audioUrl ?? "");
      const text = String(body.text ?? "").trim().slice(0, 400);
      const prompt = String(body.prompt ?? "").trim().slice(0, 900);
      if (!imageUrl || !audioUrl || !text) return bad();
      if (!checkPrompt(text).ok || (prompt && !checkPrompt(prompt).ok)) return NextResponse.json({ error: "This scene can't be used." }, { status: 422 });
      modelId = TALK_VIDEO_MODEL.id;
      input = { image_url: imageUrl, audio_url: audioUrl, prompt: prompt || "." };
      allUrls.push(imageUrl, audioUrl);
      demoUrl = makeDemoMedia({ prompt: text, kind: "video", aspectRatio: body.aspectRatio === "16:9" || body.aspectRatio === "1:1" ? body.aspectRatio : "9:16", modelName: "Talking scene" });
      break;
    }
    case "talk-native": {
      // A Full ad scene said on screen in one step: the line is written in the prompt and the model makes voice and mouth together.
      const m = NATIVE_TALK_MODELS[body.model === "seedance" ? "seedance" : "kling3"];
      const imageUrl = String(body.imageUrl ?? "");
      const prompt = String(body.prompt ?? "").trim().slice(0, 1500);
      if (!imageUrl || !prompt) return bad();
      if (!checkPrompt(prompt).ok) return NextResponse.json({ error: "This scene can't be used." }, { status: 422 });
      modelId = m.id;
      const ratio = body.aspectRatio === "16:9" || body.aspectRatio === "1:1" ? body.aspectRatio : "9:16";
      input = m.buildInput({ prompt, aspectRatio: ratio, duration: 5, sourceUrl: imageUrl, avoid: SCENE_AVOID });
      allUrls.push(imageUrl);
      demoUrl = makeDemoMedia({ prompt, kind: "video", aspectRatio: ratio, modelName: m.name });
      break;
    }
    case "join": {
      // Scenes said on screen last as long as their line, so scenes are placed one after another by their real lengths.
      const durations = Array.isArray(body.durations) ? body.durations.map((d) => Math.max(0.5, Math.min(30, Number(d) || 5))) : [];
      if (urls.length === 0 || durations.length !== urls.length) return bad();
      let at = 0;
      const keyframes = urls.map((url, i) => {
        const k = { url, timestamp: Math.round(at * 1000), duration: Math.round(durations[i] * 1000) };
        at += durations[i];
        return k;
      });
      modelId = COMPOSE_MODEL.id;
      input = { tracks: [{ id: "video", type: "video", keyframes }] };
      allUrls.push(...urls);
      demoUrl = urls[urls.length - 1];
      break;
    }
    case "script-trim": {
      // Each shot is cut to its line's length first. Stock videos come straight from Pexels or Pixabay.
      const url = String(body.url ?? "");
      const secs = Math.max(0.5, Math.min(30, Number(body.seconds) || 5));
      if (!url) return bad();
      modelId = TRIM_MODEL.id;
      input = { video_url: url, start_time: 0, duration: Math.round(secs * 100) / 100 };
      stockUrls.push(url);
      demoUrl = url;
      break;
    }
    case "script-join":
    case "script-merge": {
      // The trimmed shots (or joined sections) are re-made at one size and frame rate, so mixed sources play smoothly.
      const list = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 15) : [];
      if (list.length === 0 || list.length > 14) return bad();
      const size = body.aspectRatio === "9:16" ? { width: 720, height: 1280 } : body.aspectRatio === "1:1" ? { width: 1024, height: 1024 } : { width: 1280, height: 720 };
      modelId = MERGE_VIDEOS_MODEL.id;
      input = { video_urls: list, target_fps: 24, resolution: size };
      allUrls.push(...list);
      demoUrl = list[0];
      break;
    }
    case "voice-join": {
      const list = Array.isArray(body.audioUrls) ? body.audioUrls.map(String).slice(0, 61) : [];
      if (list.length === 0 || list.length > 60) return bad();
      modelId = MERGE_AUDIO_MODEL.id;
      input = { audio_urls: list, output_format: "mp3_44100_128" };
      allUrls.push(...list);
      demoUrl = list[0];
      break;
    }
    case "still-move": {
      const imageUrl = String(body.imageUrl ?? "");
      const prompt = String(body.prompt ?? "").trim().slice(0, 400);
      if (!imageUrl || !prompt || !checkPrompt(prompt).ok) return bad();
      const secs = Math.max(1, Math.min(10, Number(body.seconds) || 5));
      modelId = CARD_MOTION_MODEL.id;
      input = {
        image_url: imageUrl,
        prompt,
        negative_prompt: "morphing, warping, distorted, jittery, blurry, new objects, text, captions",
        num_frames: Math.min(241, Math.round(secs * 24) + 1),
        resolution: "720p",
        aspect_ratio: "auto",
      };
      allUrls.push(imageUrl);
      scriptSeconds = secs;
      demoUrl = imageUrl;
      break;
    }
    case "script-mix": {
      const videoUrl = String(body.videoUrl ?? "");
      const secs = Math.max(1, Math.min(3600, Number(body.seconds) || 0));
      if (!videoUrl || !secs) return bad();
      const ms = Math.round(secs * 1000);
      const tracks: Record<string, unknown>[] = [{ id: "video", type: "video", keyframes: [{ url: videoUrl, timestamp: 0, duration: ms }] }];
      // The voiceover, in runs of lines (a clip whose own sound is kept breaks a run).
      const voiceRuns = (Array.isArray(body.voices) ? body.voices : [])
        .filter((v) => v && typeof v.url === "string" && v.url)
        .slice(0, MAX_BEATS)
        .map((v) => ({ url: String(v.url), timestamp: Math.max(0, Math.round(Number(v.at) * 1000) || 0), duration: Math.max(500, Math.round(Number(v.seconds) * 1000) || 4000) }));
      if (voiceRuns.length) tracks.push({ id: "voice", type: "audio", keyframes: voiceRuns });
      // The person's own clips whose sound they kept.
      const keep = (Array.isArray(body.keep) ? body.keep : [])
        .filter((v) => v && typeof v.url === "string" && v.url)
        .slice(0, 60)
        .map((v) => ({ url: String(v.url), timestamp: Math.max(0, Math.round(Number(v.at) * 1000) || 0), duration: Math.max(500, Math.round(Number(v.seconds) * 1000) || 4000) }));
      if (keep.length) tracks.push({ id: "own", type: "audio", keyframes: keep });
      // One music bed, repeated under a long video.
      if (body.musicUrl) {
        const bed = 60000;
        const music = [];
        for (let t = 0; t < ms && music.length < 60; t += bed) music.push({ url: String(body.musicUrl), timestamp: t, duration: Math.min(bed, ms - t) });
        tracks.push({ id: "music", type: "audio", keyframes: music });
      }
      modelId = COMPOSE_MODEL.id;
      input = { tracks };
      allUrls.push(videoUrl, ...voiceRuns.map((v) => v.url), ...keep.map((k) => k.url), ...(body.musicUrl ? [String(body.musicUrl)] : []));
      scriptSeconds = secs;
      demoUrl = videoUrl;
      break;
    }
    case "captions": {
      const videoUrl = String(body.videoUrl ?? "");
      if (!videoUrl) return bad();
      modelId = CAPTIONS_MODEL.id;
      input = { video_url: videoUrl, language: captionLanguage(body.language), font_size: 70, words_per_subtitle: 4, position: "bottom", highlight_color: "yellow" };
      allUrls.push(videoUrl);
      scriptSeconds = Math.max(1, Math.min(3600, Number(body.seconds) || 60));
      demoUrl = videoUrl;
      break;
    }
    case "transcribe": {
      const audioUrl = String(body.audioUrl ?? "");
      if (!audioUrl) return bad();
      modelId = TRANSCRIBE_MODEL.id;
      input = { audio_url: audioUrl, task: "transcribe", chunk_level: "word", language: captionLanguage(body.language) };
      allUrls.push(audioUrl);
      scriptSeconds = Math.max(1, Math.min(3600, Number(body.seconds) || 60));
      break;
    }
    default:
      return bad();
  }

  // Demo mode has no AI service: pictures and videos pass straight through, sound is skipped.
  if (mode === "demo") return NextResponse.json({ status: "COMPLETED", demo: true, url: demoUrl });
  if (!stockUrls.every((u) => isFalMediaUrl(u) || isStockVideoUrl(u))) return NextResponse.json({ error: "Only results made in ToastyFly, or free stock videos, can be used." }, { status: 400 });
  if (!allUrls.every(isFalMediaUrl)) return NextResponse.json({ error: "Only results made in ToastyFly can be used." }, { status: 400 });

  const spoken = body.tool === "talk-scene" ? String(body.text ?? "") : typeof input.text === "string" ? input.text : "";
  const pay = await payForStep(req, toolUsd(String(body.tool), { model: body.model, seconds: body.tool === "talk-native" ? 5 : body.tool === "talk-scene" ? lineSeconds(spoken) + 0.5 : scriptSeconds || seconds, text: spoken }), TOOL_NAMES[String(body.tool)] ?? "Video tool");
  if (pay.error) return pay.error;
  try {
    const { request_id } = await fal.queue.submit(modelId, { input });
    await pay.done(request_id);
    return NextResponse.json({ status: "IN_QUEUE", requestId: request_id, modelId });
  } catch (err) {
    await pay.undo();
    console.error("tool submit failed", err);
    return NextResponse.json({ error: "The video tool had a problem. Please try again." }, { status: 502 });
  }
}

const TOOL_NAMES: Record<string, string> = {
  "talk-native": "Talking scene",
  "last-frame": "Next shot's start",
  merge: "Joining shots",
  voice: "Voiceover line",
  music: "Music",
  card: "End card",
  mix: "Mixing the ad",
  "talk-scene": "Talking scene, lips matched",
  join: "Joining scenes",
  "script-join": "Joining shots",
  "script-merge": "Joining sections",
  "voice-join": "Joining the voiceover",
  "still-move": "Picture with a slow move",
  "script-mix": "Mixing the video",
  captions: "Captions",
  transcribe: "Lining up your recording",
};

/** The captions and transcription language code, from the language name. */
function captionLanguage(l: unknown): string {
  const codes: Record<string, string> = { English: "en", Spanish: "es", French: "fr", German: "de", Italian: "it", Portuguese: "pt", Dutch: "nl", Polish: "pl", Swedish: "sv", Danish: "da", Norwegian: "no", Finnish: "fi", Greek: "el", Czech: "cs", Romanian: "ro", Hungarian: "hu", Ukrainian: "uk", Russian: "ru", Turkish: "tr", Arabic: "ar", Hindi: "hi", Tamil: "ta", Indonesian: "id", Malay: "ms", Vietnamese: "vi", Japanese: "ja", Korean: "ko", Chinese: "zh" };
  return codes[String(l)] ?? "en";
}

function bad() {
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
