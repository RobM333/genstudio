"use client";

import { useEffect, useRef, useState } from "react";

// A microphone button: people say their idea and the words are typed into the
// box for them. Uses the browser's own speech-to-text, so it costs nothing.
// Browsers without it (for example Firefox) simply don't show the button.

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognizer(): (new () => Rec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Adds spoken words to what is already typed, with a space between. */
export function joinSpoken(typed: string, spoken: string): string {
  const s = spoken.trim();
  if (!s) return typed;
  const said = s.charAt(0).toUpperCase() + s.slice(1);
  if (!typed.trim()) return said;
  return /[.!?]\s*$/.test(typed) ? `${typed.trimEnd()} ${said}` : `${typed.trimEnd()} ${s}`;
}

export default function VoiceButton({ onText, onError }: { onText: (spoken: string) => void; onError?: (msg: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  useEffect(() => {
    setSupported(recognizer() !== null);
    return () => rec.current?.stop();
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognizer();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) handler.current(e.results[i][0].transcript);
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        onError?.("Your browser blocked the microphone. Allow it in the address bar, then tap the microphone again.");
      else if (e.error === "no-speech") onError?.("I didn't hear anything. Tap the microphone and try again.");
      else if (e.error !== "aborted") onError?.("Voice typing stopped. Please try again, or type your idea.");
    };
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return (
    <button
      type="button"
      className={listening ? "tool-btn listening" : "tool-btn"}
      onClick={toggle}
      aria-pressed={listening}
      title={listening ? "Stop listening" : "Say your idea instead of typing it"}
    >
      <span aria-hidden>{listening ? "⏺" : "🎤"}</span> {listening ? "Listening… tap to stop" : "Speak"}
    </button>
  );
}
