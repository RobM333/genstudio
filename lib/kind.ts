// The one-box prompt on Home: people describe what they want without first
// choosing "image" or "video", and this works out which one they mean from
// their words. Only clear signals count; with none, the current choice stays.

import type { MediaKind } from "./models";
import { describesSeveralShots } from "./shots";

// Words that name the thing they want made.
const VIDEO_NOUN = /\b(videos?|clips?|reels?|footage|animations?|animated|animate|trailer|gif|tv ad|tv commercial|tiktok video|youtube video|short video)\b/i;
const IMAGE_NOUN = /\b(photos?|photographs?|pictures?|pics?|images?|stills?|posters?|logos?|banners?|thumbnails?|portraits?|illustrations?|drawings?|paintings?|wallpapers?|flyers?|icons?|stickers?|headshots?|covers?|mockups?|infographics?|cards?|memes?)\b/i;

// Things only a video can do: time, camera moves, sound and speech.
const VIDEO_HINTS =
  /\b(\d{1,2}\s?(?:s|sec|secs|seconds?)\b|slow[- ]motion|slo[- ]?mo|time[- ]?lapse|timelapse|camera (?:pans?|panning|zooms?|zooming|tracks?|tracking|follows?|following|moves?|moving|orbits?|orbiting|pushes|pulls|tilts?|dollies|flies)|(?:pans?|zooms?|dolly|tracking shot|push[- ]in|pull[- ]back|orbit)s? (?:in|out|to|across|around|over|past|toward|towards|away)|voice ?over|voiceover|narrat\w*|music|soundtrack|sound of|says? ["“]|speaks?|talking|singing|dialogue|over (?:\d|a few|several) seconds|starts? to|begins? to|turns? into|transforms? into|comes? to life)\b/i;

export type KindGuess = { kind: MediaKind; why: string } | null;

/** Image or video, from the words alone, or null when the words don't say. */
export function guessKind(prompt: string): KindGuess {
  const p = prompt.trim();
  if (p.length < 4) return null;
  const video = VIDEO_NOUN.exec(p);
  const image = IMAGE_NOUN.exec(p);
  // Both named ("a video of my photos", "a photo for my reel"): the first one named is what they want.
  if (video && image) {
    return video.index <= image.index ? { kind: "video", why: `you said "${video[0]}"` } : { kind: "image", why: `you said "${image[0]}"` };
  }
  if (video) return { kind: "video", why: `you said "${video[0]}"` };
  if (image) return { kind: "image", why: `you said "${image[0]}"` };
  if (describesSeveralShots(p)) return { kind: "video", why: "it has more than one shot" };
  const hint = VIDEO_HINTS.exec(p);
  if (hint) return { kind: "video", why: /\d/.test(hint[0]) ? "it has a length in seconds" : /music|sound|voice|narrat|speak|talk|sing|dialogue|says/i.test(hint[0]) ? "it has sound or speech" : "it has movement over time" };
  return null;
}
