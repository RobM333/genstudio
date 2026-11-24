"use client";

import { useState } from "react";
import type { AppMode } from "@/lib/config";
import { FILM_NAME } from "@/lib/appBrand";
import { COST_NOTE, formatCost, type AspectRatio } from "@/lib/models";
import {
  ANGLES,
  choiceById,
  emptyShot,
  FILM_VIDEO_MODELS,
  filmCost,
  HONEST_NOTE,
  LENSES,
  LIGHTS,
  LOOKS,
  MAX_CAST,
  MAX_SHOTS,
  MOVES,
  shapesFor,
  shotSecondsFor,
  SHOT_SIZES,
  type Choice,
  type FilmShot,
} from "@/lib/filmset";
import { checkPrompt } from "@/lib/safety";
import type { Character } from "@/lib/characters";
import type { Brand } from "./BrandKit";
import Characters from "./Characters";
import type { FilmCast, FilmJob } from "./filmRunner";

// Film Set: direct a picture or a short scene shot by shot, with the same
// characters in every shot.

type Draft = Omit<FilmJob, "cast"> & { castIds: string[]; outfits: Record<string, string> };

const STORE = "genstudio.film.v1";

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(STORE);
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && Array.isArray(d.shots) && d.shots.length ? d : null;
  } catch {
    return null;
  }
}
function saveDraft(d: Draft) {
  try {
    localStorage.setItem(STORE, JSON.stringify(d));
  } catch {
    // storage blocked: the form just won't be remembered
  }
}

const STARTER: Draft = {
  still: false,
  scene: { setting: "", light: "auto", look: "auto" },
  shots: [emptyShot(), emptyShot()],
  videoModelId: FILM_VIDEO_MODELS[0].id,
  seconds: 5,
  sound: true,
  aspectRatio: "16:9",
  castIds: [],
  outfits: {},
};

export function draftFromJob(job: FilmJob): Draft {
  return {
    ...job,
    shots: job.shots.map((s) => ({ action: s.action, size: s.size, angle: s.angle, lens: s.lens, move: s.move })),
    castIds: job.cast.map((c) => c.id),
    outfits: Object.fromEntries(job.cast.map((c) => [c.id, c.outfit])),
    joinedUrl: undefined,
    step: undefined,
  };
}

export default function FilmSet({
  mode,
  brand,
  onBrand,
  onStart,
  initial,
}: {
  mode: AppMode;
  brand: Brand;
  onBrand: (b: Brand) => void;
  onStart: (job: FilmJob) => string | null;
  initial?: Draft | null;
}) {
  const [d, setD] = useState<Draft>(() => initial ?? loadDraft() ?? STARTER);
  const [error, setError] = useState<string | null>(null);
  const [openShot, setOpenShot] = useState(0);
  const set = (patch: Partial<Draft>) =>
    setD((prev) => {
      const next = { ...prev, ...patch };
      saveDraft(next);
      return next;
    });
  const characters = brand.characters ?? [];
  const cast = d.castIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean) as Character[];
  const shots = d.still ? d.shots.slice(0, 1) : d.shots;
  const shapes = d.still ? (["16:9", "9:16", "1:1"] as AspectRatio[]) : shapesFor(d.videoModelId);
  const shape = shapes.includes(d.aspectRatio) ? d.aspectRatio : shapes[0];
  const secs = shotSecondsFor(d.videoModelId, d.seconds);
  const cost = filmCost({ still: d.still, shots: shots.length, videoModelId: d.videoModelId, seconds: d.seconds, sound: d.sound, cast: cast.length, newLooks: cast.filter((c) => !c.sheetUrl).length });
  const price = mode === "demo" ? "Free" : `est. ${formatCost(cost)}`;

  const setShot = (i: number, patch: Partial<FilmShot>) => set({ shots: d.shots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const pick = (c: Character) => {
    if (d.castIds.includes(c.id)) set({ castIds: d.castIds.filter((x) => x !== c.id) });
    else if (d.castIds.length < MAX_CAST) set({ castIds: [...d.castIds, c.id], outfits: { ...d.outfits, [c.id]: d.outfits[c.id] ?? c.outfit } });
    else setError(`Up to ${MAX_CAST} characters in one film, so each one stays recognisable.`);
  };

  function go() {
    setError(null);
    const used = shots.map((s) => s.action.trim());
    if (used.some((a) => a.length < 4)) return setError(d.still ? "Say what we see in the frame." : "Say what happens in each shot (or remove the empty ones).");
    const words = [d.scene.setting, ...used, ...cast.map((c) => d.outfits[c.id] ?? "")].join(". ");
    const safe = checkPrompt(words);
    if (!safe.ok) return setError(safe.reason ?? "These words can't be used.");
    const filmCast: FilmCast[] = cast.map((c) => ({ id: c.id, name: c.name, look: c.look, outfit: (d.outfits[c.id] ?? c.outfit).trim(), sheetUrl: c.sheetUrl, sheetToken: c.sheetToken, photo: c.photo }));
    const job: FilmJob = {
      still: d.still,
      scene: d.scene,
      cast: filmCast,
      shots: shots.map((s) => ({ ...s, action: s.action.trim() })),
      videoModelId: d.videoModelId,
      seconds: d.seconds,
      sound: !d.still && d.sound,
      aspectRatio: shape,
    };
    const err = onStart(job);
    if (err) setError(err);
  }

  return (
    <div className="guided film-set" aria-label={FILM_NAME}>
      <div className="guided-head">
        <span className="film-badge">🎬 {FILM_NAME}</span>
        <h1>
          Direct it <em>like a film</em>
        </h1>
        <p className="muted">Pick the camera, lens, light and look, shot by shot. Your characters keep the same face in every shot.</p>
      </div>

      <div className="film-switch" role="tablist" aria-label="What are you directing?">
        <button role="tab" aria-selected={d.still} className={d.still ? "film-switch-btn active" : "film-switch-btn"} onClick={() => set({ still: true })}>
          <strong>🖼️ One frame</strong>
          <span>A single picture, like a still from a film</span>
        </button>
        <button role="tab" aria-selected={!d.still} className={!d.still ? "film-switch-btn active" : "film-switch-btn"} onClick={() => set({ still: false })}>
          <strong>🎞️ A scene</strong>
          <span>A short video made of shots, with moving cameras</span>
        </button>
      </div>
      <p className="film-now muted small" aria-live="polite">
        {d.still
          ? "You're directing one frame: one camera position, nothing moves."
          : `You're directing ${shots.length} shot${shots.length === 1 ? "" : "s"}, about ${shots.length * secs} seconds in all. Each shot is a new camera position.`}
      </p>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">1</span>
          <h2>Cast</h2>
          <span className="step-opt">optional · up to {MAX_CAST}</span>
        </div>
        <Characters
          characters={characters}
          onChange={(list) => onBrand({ ...brand, characters: list })}
          mode={mode}
          kitPeople={brand.pictures.filter((r) => r.kind === "person")}
          compact
          onPick={pick}
          picked={d.castIds}
        />
        {cast.length > 0 && (
          <div className="film-outfits">
            {cast.map((c) => (
              <label key={c.id} className="film-outfit">
                <span className="sub-label-inline">{c.name} wears</span>
                <input
                  className="text-input"
                  maxLength={200}
                  value={d.outfits[c.id] ?? c.outfit}
                  placeholder="their usual outfit"
                  onChange={(e) => set({ outfits: { ...d.outfits, [c.id]: e.target.value } })}
                />
              </label>
            ))}
            <p className="muted small">Same face every time. The outfit stays the same in every shot of this {d.still ? "picture" : "scene"}; change it here for this one.</p>
          </div>
        )}
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">2</span>
          <h2>The scene</h2>
          <span className="step-opt">the same in every shot</span>
        </div>
        <label className="sub-label" htmlFor="film-setting">
          Where and when
        </label>
        <input
          id="film-setting"
          className="text-input"
          maxLength={300}
          placeholder="e.g. a small rooftop café in the city, early evening"
          value={d.scene.setting}
          onChange={(e) => set({ scene: { ...d.scene, setting: e.target.value } })}
        />
        <Picker label="Light" list={LIGHTS} value={d.scene.light} onPick={(light) => set({ scene: { ...d.scene, light } })} group="light" />
        <Picker label="Look" list={LOOKS} value={d.scene.look} onPick={(look) => set({ scene: { ...d.scene, look } })} group="look" />
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">3</span>
          <h2>{d.still ? "The frame" : "Shots"}</h2>
          {!d.still && <span className="step-opt">up to {MAX_SHOTS}, in order</span>}
        </div>
        <div className="film-shots">
          {shots.map((s, i) => {
            const open = openShot === i || shots.length === 1;
            const summary = [
              choiceById(SHOT_SIZES, s.size),
              choiceById(ANGLES, s.angle),
              choiceById(LENSES, s.lens),
              ...(d.still ? [] : [choiceById(MOVES, s.move)]),
            ]
              .filter((c) => c.id !== "auto")
              .map((c) => c.label)
              .join(" · ");
            return (
              <div key={i} className={open ? "film-shot open" : "film-shot"}>
                <div className="film-shot-head">
                  {!d.still && <span className="film-shot-num">Shot {i + 1}</span>}
                  <input
                    className="text-input film-action"
                    maxLength={400}
                    aria-label={d.still ? "What we see" : `What happens in shot ${i + 1}`}
                    placeholder={
                      d.still
                        ? "What we see, e.g. Mia laughing at a café table, holding a coffee cup"
                        : i === 0
                          ? "What happens, e.g. Mia walks onto the rooftop and looks out at the city"
                          : "e.g. she sits down and takes the first sip, smiling"
                    }
                    value={s.action}
                    onFocus={() => setOpenShot(i)}
                    onChange={(e) => setShot(i, { action: e.target.value })}
                  />
                  {!open && (
                    <button className="link-btn film-shot-edit" onClick={() => setOpenShot(i)}>
                      {summary || "All on Auto"} · Change
                    </button>
                  )}
                  {!d.still && shots.length > 1 && (
                    <button
                      className="link-btn"
                      aria-label={`Remove shot ${i + 1}`}
                      onClick={() => {
                        set({ shots: d.shots.filter((_, j) => j !== i) });
                        setOpenShot(Math.max(0, i - 1));
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {open && (
                  <div className="film-shot-body">
                    <Picker label="Shot size" list={SHOT_SIZES} value={s.size} onPick={(size) => setShot(i, { size })} group="size" />
                    <Picker label="Camera angle" list={ANGLES} value={s.angle} onPick={(angle) => setShot(i, { angle })} group="angle" />
                    <Picker label="Lens" list={LENSES} value={s.lens} onPick={(lens) => setShot(i, { lens })} group="lens" />
                    {!d.still && <Picker label="Camera move" list={MOVES} value={s.move} onPick={(move) => setShot(i, { move })} group="move" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!d.still && d.shots.length < MAX_SHOTS && (
          <button
            className="pill film-add"
            onClick={() => {
              set({ shots: [...d.shots, emptyShot()] });
              setOpenShot(d.shots.length);
            }}
          >
            ＋ Add a shot
          </button>
        )}
        {!d.still && shots.length > 1 && (
          <p className="muted small g-hint">Left on Auto, shot sizes go from wide to close, the way films usually cut a scene.</p>
        )}
      </section>

      <section className="g-step">
        <div className="g-head">
          <span className="g-num">4</span>
          <h2>Options</h2>
        </div>
        {!d.still && (
          <>
            <div className="sub-label">Video model</div>
            <div className="pills">
              {FILM_VIDEO_MODELS.map((m, i) => (
                <button key={m.id} className={d.videoModelId === m.id ? "pill active" : "pill"} title={m.hint} onClick={() => set({ videoModelId: m.id })}>
                  {i === 0 ? `Auto (${m.label})` : m.label}
                </button>
              ))}
            </div>
            <p className="muted small">{FILM_VIDEO_MODELS.find((m) => m.id === d.videoModelId)?.hint}</p>
            <div className="sub-label">Each shot</div>
            <div className="pills">
              {[5, 10].map((n) => (
                <button key={n} className={d.seconds === n ? "pill active" : "pill"} onClick={() => set({ seconds: n })}>
                  {n === 5 ? "Short" : "Long"} · about {shotSecondsFor(d.videoModelId, n)}s
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sub-label">Shape</div>
        <div className="pills">
          {shapes.map((a) => (
            <button key={a} className={shape === a ? "pill active" : "pill"} onClick={() => set({ aspectRatio: a })}>
              {a === "16:9" ? "Wide 16:9 · YouTube" : a === "9:16" ? "Tall 9:16 · TikTok, Reels" : "Square 1:1 · Feed"}
            </button>
          ))}
        </div>
        {!d.still && (
          <label className="refs-consent film-sound">
            <input type="checkbox" checked={d.sound} onChange={(e) => set({ sound: e.target.checked })} />
            <span>Add matching sound (ambience and effects) over the whole scene</span>
          </label>
        )}
      </section>

      <div className="generate-bar">
        <button className="generate" onClick={go} disabled={mode === "locked"}>
          <span className="generate-label">{d.still ? "🎬 Make the frame" : `🎬 Film ${shots.length} shot${shots.length === 1 ? "" : "s"}`}</span>
          <span className="generate-cost">{price}</span>
        </button>
      </div>
      {error && <p className="notice warn">{error}</p>}
      <p className="muted small g-hint">
        {mode === "demo" ? `Free in demo mode (live estimate ${formatCost(cost)}). ` : ""}
        {d.still ? "Takes about half a minute." : `Takes about ${Math.round(3 + shots.length * 0.6)} to ${Math.round(5 + shots.length)} minutes; all shots are filmed at the same time.`} {COST_NOTE}
      </p>
      <details className="film-how">
        <summary>How it works, honestly</summary>
        <p className="muted small">{HONEST_NOTE}</p>
        <p className="muted small">
          Each shot&apos;s picture is shown your characters&apos; look pictures and the first shot&apos;s picture, so the place, light and colours match. The more
          different two shots are (for example inside, then outside), the more small details can drift.
        </p>
      </details>
    </div>
  );
}

function Picker<T extends Choice>({ label, list, value, onPick, group }: { label: string; list: T[]; value: string; onPick: (id: string) => void; group: string }) {
  const cur = choiceById(list, value);
  return (
    <div className="film-picker">
      <div className="film-picker-head">
        <span className="sub-label-inline">{label}</span>
        <span className="muted small">{cur.id === "auto" ? cur.hint : `${cur.label}: ${cur.hint}`}</span>
      </div>
      <div className="film-cards" role="radiogroup" aria-label={label}>
        {list.map((c) => (
          <button key={c.id} role="radio" aria-checked={c.id === cur.id} className={c.id === cur.id ? "film-card on" : "film-card"} title={c.hint} onClick={() => onPick(c.id)}>
            <FilmIcon group={group} choice={c} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small drawings so people who don't know film words can see what each choice means. */
export function FilmIcon({ group, choice }: { group: string; choice: Choice & { colors?: string[] } }) {
  const id = choice.id;
  const stroke = "currentColor";
  const box = <rect x="3" y="4" width="50" height="32" rx="4" fill="none" stroke={stroke} strokeOpacity="0.35" />;
  const person = (cx: number, top: number, h: number) => {
    const r = h * 0.16;
    return (
      <g fill={stroke}>
        <circle cx={cx} cy={top + r} r={r} />
        <rect x={cx - r * 1.3} y={top + r * 2.3} width={r * 2.6} height={h - r * 2.3} rx={r * 0.9} />
      </g>
    );
  };
  const arrow = (d: string) => <path d={d} fill="none" stroke="var(--cyan)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />;
  const cam = (x: number, y: number, rot: number) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} fill="var(--ember)">
      <rect x="-5" y="-3.5" width="8" height="7" rx="1.5" />
      <path d="M3 -2 L7 -4 L7 4 L3 2 Z" />
    </g>
  );
  let body: React.ReactNode = null;

  if (id === "auto") {
    body = <path d="M28 9 L30.5 17.5 L39 20 L30.5 22.5 L28 31 L25.5 22.5 L17 20 L25.5 17.5 Z" fill="var(--iris)" />;
  } else if (group === "light" && choice.colors) {
    body = (
      <>
        <defs>
          <linearGradient id={`l-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={choice.colors[0]} />
            <stop offset="1" stopColor={choice.colors[1]} />
          </linearGradient>
        </defs>
        <rect x="3" y="4" width="50" height="32" rx="4" fill={`url(#l-${id})`} />
        {person(28, 14, 20)}
      </>
    );
  } else if (group === "look" && choice.colors) {
    body = (
      <g>
        {choice.colors.map((c, i) => (
          <rect key={i} x={3 + i * 16.7} y="4" width="16.7" height="32" fill={c} />
        ))}
        <rect x="3" y="4" width="50" height="32" rx="4" fill="none" stroke={stroke} strokeOpacity="0.35" />
      </g>
    );
  } else if (group === "size") {
    const s: Record<string, React.ReactNode> = {
      wide: (
        <>
          <path d="M3 28 H53" stroke={stroke} strokeOpacity="0.4" />
          {person(28, 20, 8)}
        </>
      ),
      full: person(28, 8, 26),
      medium: person(28, 7, 40),
      close: <circle cx="28" cy="22" r="13" fill={stroke} />,
      detail: (
        <g fill="none" stroke={stroke} strokeWidth="2">
          <path d="M12 20 Q28 8 44 20 Q28 32 12 20 Z" />
          <circle cx="28" cy="20" r="5" fill={stroke} />
        </g>
      ),
    };
    body = (
      <>
        <clipPath id={`c-${id}`}>
          <rect x="3" y="4" width="50" height="32" rx="4" />
        </clipPath>
        <g clipPath={`url(#c-${id})`}>{s[id]}</g>
        {box}
      </>
    );
  } else if (group === "angle") {
    const a: Record<string, React.ReactNode> = {
      eye: (
        <>
          {person(38, 10, 24)}
          {cam(12, 16, 0)}
        </>
      ),
      low: (
        <>
          {person(38, 6, 26)}
          {cam(12, 32, -30)}
        </>
      ),
      high: (
        <>
          {person(38, 14, 20)}
          {cam(12, 8, 30)}
        </>
      ),
      top: (
        <>
          <circle cx="28" cy="26" r="7" fill={stroke} />
          {cam(28, 8, 90)}
        </>
      ),
      shoulder: (
        <>
          {person(40, 12, 18)}
          <g fill={stroke} opacity="0.55">
            <circle cx="14" cy="22" r="8" />
            <rect x="2" y="29" width="26" height="12" rx="6" />
          </g>
        </>
      ),
      side: (
        <g fill={stroke}>
          <circle cx="28" cy="13" r="5" />
          <path d="M31 12 L34 14 L31 15 Z" />
          <rect x="24" y="19" width="8" height="15" rx="3" />
        </g>
      ),
    };
    body = (
      <>
        {box}
        {a[id]}
      </>
    );
  } else if (group === "lens") {
    const spread: Record<string, number> = { wide: 16, natural: 10, portrait: 6, long: 3, macro: 8 };
    const w = spread[id] ?? 8;
    body = (
      <>
        {box}
        <path d={`M10 20 L46 ${20 - w} L46 ${20 + w} Z`} fill="var(--iris)" fillOpacity="0.35" />
        {cam(10, 20, 0)}
        {id === "portrait" && (
          <g fill={stroke} opacity="0.3">
            <circle cx="47" cy="10" r="3" />
            <circle cx="49" cy="29" r="4" />
          </g>
        )}
        {id === "macro" && <circle cx="44" cy="20" r="3" fill="var(--ember)" />}
      </>
    );
  } else if (group === "move") {
    const m: Record<string, React.ReactNode> = {
      still: (
        <g stroke={stroke} strokeWidth="1.8" fill="none">
          <rect x="22" y="9" width="12" height="9" rx="2" fill={stroke} />
          <path d="M28 18 L21 33 M28 18 L35 33 M28 18 L28 33" />
        </g>
      ),
      in: arrow("M10 10 L20 16 M46 10 L36 16 M10 30 L20 24 M46 30 L36 24"),
      out: arrow("M20 16 L10 10 M36 16 L46 10 M20 24 L10 30 M36 24 L46 30"),
      track: (
        <>
          {person(28, 9, 18)}
          {arrow("M12 32 H44 M39 28 L44 32 L39 36")}
        </>
      ),
      follow: (
        <>
          {person(34, 10, 18)}
          {arrow("M8 20 H24 M19 15 L24 20 L19 25")}
        </>
      ),
      orbit: (
        <>
          {person(28, 11, 16)}
          {arrow("M10 26 Q28 38 46 26 M42 22 L46 26 L41 29")}
        </>
      ),
      rise: arrow("M28 33 V9 M22 15 L28 9 L34 15"),
      pan: arrow("M10 24 Q28 10 46 24 M41 18 L46 24 L39 25"),
      handheld: arrow("M8 20 Q13 14 18 20 T28 20 T38 20 T48 20"),
      fly: (
        <>
          <path d="M3 34 L16 24 L26 30 L38 20 L53 32" fill="none" stroke={stroke} strokeOpacity="0.5" />
          {arrow("M10 12 H44 M39 8 L44 12 L39 16")}
        </>
      ),
    };
    body = (
      <>
        {box}
        {m[id]}
      </>
    );
  }
  return (
    <svg className="film-icon" viewBox="0 0 56 40" width="56" height="40" aria-hidden>
      {body}
    </svg>
  );
}
