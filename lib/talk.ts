// Talking videos in your own voice. Set up once: the user records about a
// minute of their own voice, starting with a consent sentence that has a fresh
// code in it, and adds a photo of themselves. We copy the voice only after the
// recording passes a check: the sentence and the code must be in it, spoken by
// one person. After that they type what to say, and the app reads it in their
// voice and makes a video of them saying it, with their lips matching.
// There are no accounts yet, so the voice copy and the photo live in this browser.

/** Prices checked on fal.ai 2026-11-24. */
export const TALK_PRICES = {
  clone: 1.5, // MiniMax voice clone, once per voice
  transcribe: 0.03, // ElevenLabs speech to text, per minute: checks the consent sentence
  speechPer1000Chars: 0.1, // MiniMax Speech-02 HD reading the words in the copied voice
  videoPerSecond: 0.115, // Kling AI Avatar v2 Pro: the photo talks, lips matched to the voice
};

export const TALK_SPEECH_MODEL_ID = "fal-ai/minimax/speech-02-hd";
export const TALK_VIDEO_MODEL_ID = "fal-ai/kling-video/ai-avatar/v2/pro";
export const VOICE_CLONE_MODEL_ID = "fal-ai/minimax/voice-clone";
export const TRANSCRIBE_MODEL_ID = "fal-ai/elevenlabs/speech-to-text";

export const MIN_RECORD_SECONDS = 30;
export const MAX_RECORD_SECONDS = 90;
export const MAX_TALK_SECONDS = 60;
export const MAX_TALK_CHARS = 900;
/** A consent code is good for 30 minutes after it is shown. */
export const CODE_MINUTES = 30;
/** The short line read in the new voice straight after setup, so the user can hear it (and the copy is kept). */
export const SAMPLE_LINE = "Hi! This is my own voice, made with ToastyFly. Pretty close, right?";

/** The consent sentence the user reads aloud first. The code proves it was said just now. */
export function consentSentence(code: string): string {
  return `I am recording my own voice for ToastyFly, and I agree to it making a copy of my voice. My code is ${code.split("").join(" ")}.`;
}

/** Something natural to keep reading after the consent sentence, so the copy has enough of the voice. */
export const READING_SCRIPT =
  "The best part of my week is the quiet first hour of the morning. I make a coffee, open the window and listen to the street wake up. " +
  "Some days I plan everything down to the minute, and other days I just see where things go. " +
  "I like simple things done well: good bread, an honest conversation, and a walk when the light turns gold in the evening. " +
  "If you asked me for one piece of advice, I would say this: start small, keep going, and be kind to yourself along the way. " +
  "Thanks for listening. That is me, in my own words and my own voice.";

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The digits said in a transcript, in order, whether written as numbers or words. */
function spokenDigits(text: string): string {
  return words(text)
    .map((w) => (/^\d+$/.test(w) ? w : (NUMBER_WORDS[w] ?? " ")))
    .join("")
    .replace(/\s+/g, " ");
}

export type ConsentCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks the transcript of the recording: the consent sentence's key words and
 * the code must be there, and only one person may be speaking.
 */
export function checkConsent(transcript: string, code: string, speakers = 1): ConsentCheck {
  const said = new Set(words(transcript));
  const missing = ["own", "voice", "agree", "copy"].filter((w) => !said.has(w));
  if (!transcript.trim()) return { ok: false, reason: "We couldn't hear anything. Check your microphone and try again." };
  if (speakers > 1) return { ok: false, reason: "We heard more than one person. Only the person whose voice it is can record it, on their own." };
  if (missing.length) return { ok: false, reason: "We couldn't hear the consent sentence. Please start by reading it out exactly as shown." };
  if (!spokenDigits(transcript).replace(/\s/g, "").includes(code)) return { ok: false, reason: "We couldn't hear your code. Please read the code shown on screen clearly, one number at a time." };
  return { ok: true };
}

/** A new four-digit code. */
export function newCode(rand: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => String(Math.floor(rand() * 10))).join("");
}

/** Languages written without spaces are timed by characters. */
const NO_SPACES = ["Japanese", "Chinese"];

/** About how long the words take to say, in seconds (about 150 words a minute). */
export function talkSeconds(text: string, language?: string): number {
  const t = text.trim();
  if (!t) return 0;
  const secs = language && NO_SPACES.includes(language) ? t.length / 5 : t.split(/\s+/).length / 2.5;
  return Math.max(3, Math.ceil(secs));
}

/** What a talking video costs us: reading the words, then the talking video. */
export function talkCost(seconds: number, chars = seconds * 15): number {
  return (chars / 1000) * TALK_PRICES.speechPer1000Chars + Math.max(3, seconds) * TALK_PRICES.videoPerSecond;
}

/** What the one-time voice setup costs us: the check, the copy and the short sample. */
export function setupCost(): number {
  return TALK_PRICES.transcribe * (MAX_RECORD_SECONDS / 60) + TALK_PRICES.clone + (SAMPLE_LINE.length / 1000) * TALK_PRICES.speechPer1000Chars;
}

/** Our voiceover languages, as the speech model names them ("auto" when it has no special setting). */
const SPEECH_LANGUAGES = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Polish", "Swedish", "Danish", "Norwegian", "Finnish",
  "Greek", "Czech", "Romanian", "Hungarian", "Ukrainian", "Russian", "Turkish", "Arabic", "Hindi", "Indonesian", "Malay",
  "Vietnamese", "Japanese", "Korean", "Chinese",
];
export function speechLanguage(language?: string): string {
  return language && SPEECH_LANGUAGES.includes(language) ? language : "auto";
}

/** How the talking video should move: natural, to camera, nothing added. */
export const TALK_MOTION =
  "The person talks naturally and warmly straight to the camera, with small natural head movements and blinks. Keep the same face, clothes and background. No text on screen.";
