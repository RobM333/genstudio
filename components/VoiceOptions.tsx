"use client";

import { AD_VOICES } from "@/lib/adplan";
import { isOwnVoice } from "@/lib/elevenlabs";
import { usableVoices, type ElevenConnection } from "./elevenConnect";

/** The voice choices: our built-in voices, then the user's connected ElevenLabs voices. */
export function OwnVoiceOptions({ eleven, current }: { eleven: ElevenConnection | null; current?: string }) {
  const own = usableVoices(eleven);
  const missing = isOwnVoice(current) && !own.some((v) => `el:${v.id}` === current);
  return (
    <>
      <optgroup label="Our voices">
        {AD_VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </optgroup>
      {(own.length > 0 || missing) && (
        <optgroup label="Your ElevenLabs voices">
          {own.map((v) => (
            <option key={v.id} value={`el:${v.id}`}>
              {v.name}
            </option>
          ))}
          {missing && <option value={current}>Your ElevenLabs voice (not connected here)</option>}
        </optgroup>
      )}
    </>
  );
}
