// Film Set: direct a picture (one frame) or a short scene (a few shots) like a
// film crew would. For each shot the user picks the shot size, the camera
// angle, the lens and (for videos) how the camera moves. Light and look are
// chosen once for the whole scene, so every shot matches. Saved characters
// keep the same face in every shot.
//
// How honest each choice is: none of our video models (Kling 2.5 Turbo Pro,
// Kling 4, Hailuo 02, Veo 3 Fast on fal.ai) has a camera-control setting, so
// camera moves, sizes, angles, lenses, light and looks are written into the
// prompt in the words these models follow best. What IS a real control:
// every shot starts from a picture we make first (the model must start from
// it exactly), and that picture is made with the characters' look pictures,
// so faces and outfits are held by the picture, not by luck.

import { animateModelFor, estimateCost, getModel, KEYFRAME_MODEL_ID, ADD_SOUND_MODEL, MERGE_VIDEOS_MODEL, REFERENCE_IMAGE_MODEL, type AspectRatio } from "./models";

export type Choice = { id: string; label: string; hint: string; phrase: string };

const AUTO: Choice = { id: "auto", label: "Auto", hint: "We pick what suits the shot.", phrase: "" };

/** How big the subject is in the frame. */
export const SHOT_SIZES: Choice[] = [
  AUTO,
  { id: "wide", label: "Wide", hint: "The whole place, people small in it. Great to open a scene.", phrase: "wide establishing shot showing the whole location, people small in the frame" },
  { id: "full", label: "Full body", hint: "Head to toe, with some space around.", phrase: "full shot, the whole body from head to toe in frame" },
  { id: "medium", label: "Waist up", hint: "Natural, like talking to someone.", phrase: "medium shot from the waist up" },
  { id: "close", label: "Close-up", hint: "The face fills the frame. Shows feeling.", phrase: "close-up, the face filling most of the frame" },
  { id: "detail", label: "Detail", hint: "A hand, an eye, a product up close.", phrase: "extreme close-up on one small detail" },
];

/** Where the camera is, looking at the subject. */
export const ANGLES: Choice[] = [
  AUTO,
  { id: "eye", label: "Eye level", hint: "Straight on. Honest and calm.", phrase: "camera at eye level" },
  { id: "low", label: "From below", hint: "Looking up. Makes them look strong.", phrase: "low angle, camera below looking up at the subject" },
  { id: "high", label: "From above", hint: "Looking down. Makes them look small.", phrase: "high angle, camera above looking down at the subject" },
  { id: "top", label: "Straight down", hint: "Bird's-eye, flat like a map.", phrase: "top-down overhead view, camera pointing straight down" },
  { id: "shoulder", label: "Over the shoulder", hint: "Behind one person, looking past them.", phrase: "over-the-shoulder shot, from just behind one person's shoulder" },
  { id: "side", label: "Side on", hint: "In profile, from the side.", phrase: "side-on profile view" },
];

/** The lens feel: how much you see and how soft the background is. */
export const LENSES: Choice[] = [
  AUTO,
  { id: "wide", label: "Wide lens", hint: "See lots, feels big and close. 24mm.", phrase: "24mm wide-angle lens, deep focus" },
  { id: "natural", label: "Natural", hint: "Like your eyes see it. 35mm.", phrase: "35mm lens, natural perspective" },
  { id: "portrait", label: "Soft background", hint: "Sharp subject, creamy blur behind. 85mm.", phrase: "85mm portrait lens, shallow depth of field, softly blurred background" },
  { id: "macro", label: "Macro", hint: "Tiny things, huge and sharp.", phrase: "macro lens, extreme detail, very shallow focus" },
  { id: "long", label: "Long lens", hint: "From far away, background pulled close. 135mm.", phrase: "135mm telephoto lens, compressed background" },
];

/** How the camera moves during a video shot (not for pictures). */
export const MOVES: Choice[] = [
  AUTO,
  { id: "still", label: "Stay still", hint: "The camera doesn't move. Calm and clear.", phrase: "the camera stays completely still on a tripod" },
  { id: "in", label: "Move in", hint: "Slowly gets closer. Builds focus.", phrase: "the camera slowly pushes in towards the subject" },
  { id: "out", label: "Pull back", hint: "Slowly moves away to reveal more.", phrase: "the camera slowly pulls back to reveal more of the scene" },
  { id: "track", label: "Move alongside", hint: "Travels next to them as they move.", phrase: "the camera tracks smoothly alongside the subject at the same speed" },
  { id: "follow", label: "Follow", hint: "Stays behind them as they go.", phrase: "the camera follows behind the subject as they move" },
  { id: "orbit", label: "Circle around", hint: "Goes around the subject in an arc.", phrase: "the camera circles slowly around the subject in a smooth arc" },
  { id: "rise", label: "Rise up", hint: "Lifts up and over, like a crane.", phrase: "the camera rises smoothly upwards, like a crane shot" },
  { id: "pan", label: "Turn across", hint: "Turns from one side to the other.", phrase: "the camera pans slowly from left to right" },
  { id: "handheld", label: "Handheld", hint: "Small natural shakes. Feels real.", phrase: "handheld camera with small natural movements, documentary feel" },
  { id: "fly", label: "Fly over", hint: "Drone-style, gliding over the place.", phrase: "aerial drone shot gliding forward over the scene" },
];

/** Light for the whole scene, so every shot matches. Colours are for the little preview swatch. */
export const LIGHTS: (Choice & { colors: [string, string] })[] = [
  { ...AUTO, colors: ["#3b4256", "#8a93a8"] },
  { id: "golden", label: "Golden hour", hint: "Low warm sun, long soft shadows.", phrase: "golden hour sunlight, low warm sun from the side, long soft shadows", colors: ["#f7b267", "#f25f5c"] },
  { id: "daylight", label: "Soft daylight", hint: "Bright window light, gentle shadows.", phrase: "soft natural daylight from a large window, gentle shadows", colors: ["#e8eef5", "#a7c4e0"] },
  { id: "studio", label: "Studio", hint: "Clean, even and flattering.", phrase: "clean studio lighting with a large soft key light and a subtle rim light", colors: ["#f4f4f4", "#bdbdbd"] },
  { id: "overcast", label: "Cloudy", hint: "Even, quiet grey light.", phrase: "flat overcast daylight, even and soft, muted shadows", colors: ["#c9ced6", "#7d8794"] },
  { id: "blue", label: "Blue hour", hint: "Just after sunset, cool and calm.", phrase: "blue hour twilight, cool blue ambient light with a few warm practical lights", colors: ["#3a5a9b", "#f0a868"] },
  { id: "neon", label: "Neon night", hint: "City signs, pink and blue glow.", phrase: "night, lit by pink and blue neon signs, reflections on wet surfaces", colors: ["#ff3fa4", "#2f6bff"] },
  { id: "moody", label: "Moody", hint: "Mostly dark, one strong light.", phrase: "low-key moody lighting, one hard light from the side, deep shadows", colors: ["#1c1c22", "#a0774b"] },
  { id: "candle", label: "Warm glow", hint: "Lamps or candles, cosy and close.", phrase: "warm low light from lamps and candles, cosy orange glow", colors: ["#ffb347", "#6b3a1f"] },
];

/** The overall film look (colour and texture), for the whole scene. */
export const LOOKS: (Choice & { colors: [string, string, string] })[] = [
  { ...AUTO, colors: ["#555c70", "#8a93a8", "#c5cad6"] },
  { id: "clean", label: "Clean ad", hint: "Crisp, bright and polished.", phrase: "clean polished commercial look, crisp detail, true-to-life colours", colors: ["#ffffff", "#d9e2ec", "#2f80ed"] },
  { id: "film", label: "Warm film", hint: "Soft grain and warm colours, like 35mm film.", phrase: "shot on 35mm film, fine grain, warm colours, gentle contrast", colors: ["#e9c46a", "#f4a261", "#6d4c41"] },
  { id: "thriller", label: "Night thriller", hint: "Cool shadows, warm skin, high tension.", phrase: "cinematic thriller grade, teal shadows and warm skin tones, high contrast", colors: ["#0f3d3e", "#2a9d8f", "#e9a36a"] },
  { id: "airy", label: "Bright and airy", hint: "Light, fresh and soft.", phrase: "bright airy look, soft pastel tones, lifted shadows", colors: ["#fdf6f0", "#f6d6d6", "#cde7f0"] },
  { id: "retro", label: "Retro 70s", hint: "Faded warm tones and soft focus.", phrase: "1970s retro look, faded warm colours, soft focus, light film grain", colors: ["#d08c60", "#b5838d", "#6d6875"] },
  { id: "mono", label: "Black and white", hint: "Timeless, all about light and shape.", phrase: "black and white, rich contrast, deep blacks", colors: ["#111111", "#777777", "#eeeeee"] },
  { id: "real", label: "Real life", hint: "Natural, like a real person filmed it.", phrase: "natural documentary look, true colours, no heavy grading", colors: ["#a3b18a", "#dad7cd", "#588157"] },
  { id: "dream", label: "Dreamy", hint: "Soft glow and gentle haze.", phrase: "dreamy look, soft glow around highlights, gentle haze", colors: ["#e0c3fc", "#f8c8dc", "#c3d9fc"] },
];

export const choiceById = <T extends Choice>(list: T[], id: string | undefined): T => list.find((c) => c.id === id) ?? list[0];

export type FilmShot = {
  action: string; // what happens (or what we see) in this shot
  size: string;
  angle: string;
  lens: string;
  move: string; // video only
};

export type FilmScene = {
  setting: string; // where and when
  light: string;
  look: string;
};

/** A character as used in one film: the saved look, with this film's outfit. */
export type CastMember = { id: string; name: string; look: string; outfit: string };

export const MAX_SHOTS = 6;
export const MAX_CAST = 3;

export const emptyShot = (): FilmShot => ({ action: "", size: "auto", angle: "auto", lens: "auto", move: "auto" });

/**
 * When the size is left on Auto, a scene is cut the way editors usually do:
 * open wide so people know where they are, then move closer as it goes on.
 */
export function autoSize(i: number, n: number, still: boolean): string {
  if (still || n === 1) return "";
  if (i === 0) return choiceById(SHOT_SIZES, "wide").phrase;
  if (i === n - 1) return choiceById(SHOT_SIZES, "close").phrase;
  return choiceById(SHOT_SIZES, i % 2 ? "medium" : "full").phrase;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");

/** Who is in the film, in plain words. Outfits can change per film; faces never do. */
export function castLine(cast: CastMember[]): string {
  return cast
    .map((c) => `${tidy(c.name) || "The character"}${c.look.trim() ? ` (${tidy(c.look)})` : ""}${c.outfit.trim() ? `, wearing ${tidy(c.outfit)}` : ""}`)
    .join("; ");
}

/** The choices the user made, as one line the prompt booster is told to keep exactly. */
function choicesLine(shot: FilmShot, scene: FilmScene, i: number, n: number, still: boolean, withMove: boolean): string {
  const size = choiceById(SHOT_SIZES, shot.size).phrase || autoSize(i, n, still);
  const parts = [
    size,
    choiceById(ANGLES, shot.angle).phrase,
    choiceById(LENSES, shot.lens).phrase,
    withMove ? choiceById(MOVES, shot.move).phrase : "",
    choiceById(LIGHTS, scene.light).phrase,
    choiceById(LOOKS, scene.look).phrase,
  ].filter(Boolean);
  return parts.length ? `Director's choices: ${parts.join("; ")}.` : "";
}

/**
 * The prompt for a shot's picture: the first frame of a video shot, or the
 * whole result when directing one frame.
 */
export function framePrompt(opts: { shot: FilmShot; scene: FilmScene; cast: CastMember[]; i: number; n: number; still: boolean }): string {
  const { shot, scene, cast, i, n, still } = opts;
  const lines = [
    `${tidy(shot.action) || "The characters in the scene"}.`,
    scene.setting.trim() ? `Setting: ${tidy(scene.setting)}.` : "",
    cast.length ? `Characters: ${castLine(cast)}. Keep each character's face, hair, skin tone, age and build exactly the same as their look picture.` : "",
    choicesLine(shot, scene, i, n, still, false),
    still ? "One single frame from one camera position, cinematic, photoreal." : `Shot ${i + 1} of ${n} of the same scene, cinematic, photoreal.`,
  ];
  return lines.filter(Boolean).join(" ").slice(0, 1800);
}

/** The prompt that brings a shot's first frame to life. */
export function motionPrompt(opts: { shot: FilmShot; scene: FilmScene; cast: CastMember[]; i: number; n: number }): string {
  const { shot, scene, cast, i, n } = opts;
  const move = choiceById(MOVES, shot.move).phrase;
  const lines = [
    `${tidy(shot.action) || "Natural, subtle movement"}.`,
    move ? `Camera: ${move}.` : "",
    choicesLine({ ...shot, move: "auto" }, scene, i, n, false, false),
    cast.length ? `Same ${cast.length > 1 ? "characters" : "character"}, faces and outfits as the first frame the whole time.` : "",
  ];
  return lines.filter(Boolean).join(" ").slice(0, 1800);
}

/** The video models a film can use, best value first. Auto uses the first. */
export const FILM_VIDEO_MODELS = [
  { id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", label: "Kling 2.5 Turbo Pro", hint: "Cinematic motion, good value. Our pick." },
  { id: "kling/v4/text-to-video", label: "Kling 4 (premium)", hint: "Sharpest and most lifelike, full HD." },
  { id: "fal-ai/veo3/fast", label: "Google Veo 3 Fast", hint: "Very realistic. Wide or tall only." },
  { id: "fal-ai/minimax/hailuo-02/standard/text-to-video", label: "Hailuo 02", hint: "Lowest price, a little softer." },
];

/** The shot length a model can actually make, nearest to what was asked (5 or 10 seconds). */
export function shotSecondsFor(videoModelId: string, want: number): number {
  const durations = animateModelFor(videoModelId).durations ?? [5];
  return durations.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), durations[0]);
}

/** Shapes a model can make from a picture. */
export function shapesFor(videoModelId: string): AspectRatio[] {
  return animateModelFor(videoModelId).aspectRatios;
}

/** The model that makes a one-frame film still when nobody saved is in it. */
export const STILL_MODEL_ID = "fal-ai/flux-pro/v1.1-ultra";

/** Rough cost of a whole film in USD, before it is shown as a range. */
export function filmCost(opts: { still: boolean; shots: number; videoModelId: string; seconds: number; sound: boolean; cast: number; newLooks: number }): number {
  const frame = estimateCost(opts.cast > 0 ? REFERENCE_IMAGE_MODEL : getModel(opts.still ? STILL_MODEL_ID : KEYFRAME_MODEL_ID)!);
  const looks = opts.newLooks * estimateCost(REFERENCE_IMAGE_MODEL);
  if (opts.still) return looks + frame;
  const anim = animateModelFor(opts.videoModelId);
  const secs = shotSecondsFor(opts.videoModelId, opts.seconds);
  return (
    looks +
    opts.shots * (frame + estimateCost(anim, secs, false)) +
    (opts.shots > 1 ? estimateCost(MERGE_VIDEOS_MODEL) : 0) +
    (opts.sound ? estimateCost(ADD_SOUND_MODEL, opts.shots * secs, true) : 0)
  );
}

/** Plain words on what each choice really does, shown under "How it works". */
export const HONEST_NOTE =
  "Shot size, angle, lens, camera move, light and look are written into the instructions in the words these video models follow best. They follow them most of the time, not every time. What is locked for sure: every shot starts from a picture we make first, with your characters' look pictures, so faces and outfits hold from shot to shot.";
