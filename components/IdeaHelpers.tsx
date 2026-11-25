"use client";

import { useEffect, useRef, useState } from "react";
import type { AppMode } from "@/lib/config";
import { seasonFor, weekDays, type Idea } from "@/lib/ideas";
import { brandInfo, hasBrand, type Brand } from "./BrandKit";

// Idea helpers for people who don't know what to make yet:
// "Give me ideas" (5 concepts from their business and goal), "Plan my week"
// (7 posts from the brand kit and the season) and "Make one like this for my
// brand" (an example or template rewritten for their product).

const STORE = "genstudio.ideas.v1";

type Saved = { business?: string; goal?: string; ideas?: Idea[]; week?: Idea[]; weekMade?: string };

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    if (s && typeof s === "object") return s;
  } catch {
    // nothing saved, or storage blocked
  }
  return {};
}

function save(patch: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...load(), ...patch }));
  } catch {
    // storage full or blocked: ideas just won't be remembered
  }
}

/** What the business sells, from the brand kit or what the user typed last time. */
export function businessFor(brand: Brand): string {
  return (brand.business || "").trim() || (load().business ?? "").trim() || (brand.name ?? "").trim();
}

async function callIdeas(body: Record<string, unknown>): Promise<{ ideas?: Idea[]; prompt?: string; fields?: Record<string, string> }> {
  const res = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't get ideas right now. Please try again.");
  return data;
}

function IdeaCard({ idea, onUse }: { idea: Idea; onUse: (i: Idea) => void }) {
  return (
    <div className="director-card idea-card">
      {idea.day && <span className="idea-day">{idea.day}</span>}
      <div className="director-card-head">
        <strong>{idea.title}</strong>
        <span className="muted small">
          {idea.kind === "video" ? `🎬 Video ${idea.seconds}s` : "🖼 Picture"} · {idea.shape}
        </span>
      </div>
      <p className="small">{idea.why}</p>
      <details>
        <summary className="muted small">See the prompt</summary>
        <p className="small">{idea.prompt}</p>
      </details>
      <button className="pill active" onClick={() => onUse(idea)}>
        Make this →
      </button>
    </div>
  );
}

/** The week plan: seven posts from the brand kit, remembered in this browser. */
export function WeekPlan({ brand, mode, onUse, compact }: { brand: Brand; mode: AppMode; onUse: (i: Idea) => void; compact?: boolean }) {
  const [week, setWeek] = useState<Idea[]>([]);
  const [made, setMade] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cards = useRef<HTMLDivElement>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    // New posts appear under the button, often below the fold: bring them into view.
    if (fresh && week.length) cards.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [fresh, week]);
  useEffect(() => {
    const s = load();
    setWeek(s.week ?? []);
    setMade(s.weekMade ?? "");
  }, []);
  const business = businessFor(brand);
  const ready = Boolean(business);

  async function plan() {
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await callIdeas({ mode: "week", business, brand: brandInfo(brand), days: weekDays(now), season: seasonFor(now, zone) });
      const ideas = data.ideas ?? [];
      const when = now.toLocaleDateString(undefined, { day: "numeric", month: "short" });
      if (!ideas.length) throw new Error("No posts came back. Please try again.");
      setWeek(ideas);
      setFresh(true);
      setMade(when);
      save({ week: ideas, weekMade: when });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="week-plan">
      {!compact && (
        <p className="muted small">
          We plan one post for each of the next 7 days from your brand kit, the season and what is coming up this week. Each one is ready to make with one click.
        </p>
      )}
      {!ready && <p className="muted small">Add your brand name or what you sell to your brand kit first.</p>}
      {ready && !(brand.business ?? "").trim() && (
        <p className="muted small">Tip: fill in &quot;What you sell&quot; above so the posts show your real product.</p>
      )}
      <div className="idea-actions">
        <button className="pill active" onClick={plan} disabled={busy || !ready || mode === "locked"}>
          {busy ? "Planning your week..." : week.length ? "📅 Plan a new week" : "📅 Plan my week of posts"}
        </button>
        <span className="tag">{mode === "demo" ? "Free" : "under 1 cent"}</span>
        {week.length > 0 && made && <span className="muted small">Planned {made}</span>}
      </div>
      {error && <p className="error small">{error}</p>}
      {week.length > 0 && (
        <div className="director-cards idea-cards" ref={cards}>
          {week.map((i, n) => (
            <IdeaCard key={`${i.day}-${n}`} idea={i} onUse={onUse} />
          ))}
        </div>
      )}
    </div>
  );
}

/** "Give me ideas": a closed button until opened, then the business and goal boxes and 5 concepts. */
export function IdeasBox({
  brand,
  mode,
  open,
  onOpen,
  onUse,
}: {
  brand: Brand;
  mode: AppMode;
  open: boolean;
  onOpen: (open: boolean) => void;
  onUse: (i: Idea) => void;
}) {
  const [business, setBusiness] = useState("");
  const [goal, setGoal] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"ideas" | "week">("ideas");
  useEffect(() => {
    const s = load();
    setBusiness(brand.business || s.business || "");
    setGoal(s.goal ?? "");
    setIdeas(s.ideas ?? []);
    // Only when the box first appears: later brand edits shouldn't wipe what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function get() {
    if (!business.trim()) {
      setError("Tell us your business first, even a few words.");
      return;
    }
    setBusy(true);
    setError(null);
    save({ business, goal });
    try {
      const data = await callIdeas({ mode: "ideas", business, goal, brand: brandInfo(brand) });
      setIdeas(data.ideas ?? []);
      save({ ideas: data.ideas ?? [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="director-ask ideas-ask" onClick={() => onOpen(true)} disabled={mode === "locked"}>
        <span>
          💡 <strong>Not sure what to make? Give me ideas</strong>
          <span className="muted small"> Tell us your business and goal, and get 5 ad and post ideas, each ready to make with one click.</span>
        </span>
        <span className="tag">{mode === "demo" ? "Free" : "under 1 cent"}</span>
      </button>
    );

  return (
    <div className="director-box ideas-box">
      <div className="director-head">
        <strong>💡 Ideas for your business</strong>
        <button className="link-btn" onClick={() => onOpen(false)}>
          Close
        </button>
      </div>
      {hasBrand(brand) && (
        <div className="mini-tabs idea-tabs">
          <button className={tab === "ideas" ? "active" : ""} onClick={() => setTab("ideas")}>
            5 ideas
          </button>
          <button className={tab === "week" ? "active" : ""} onClick={() => setTab("week")}>
            A week of posts
          </button>
        </div>
      )}
      {tab === "week" && hasBrand(brand) ? (
        <WeekPlan brand={brand} mode={mode} onUse={onUse} />
      ) : (
        <>
          <label className="sub-label" htmlFor="idea-business">
            Your business, and what you sell
          </label>
          <input
            id="idea-business"
            className="text-input"
            maxLength={400}
            placeholder="e.g. a small bakery in Melbourne selling sourdough and pastries"
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
          />
          <label className="sub-label" htmlFor="idea-goal">
            Your goal <span className="step-opt">optional</span>
          </label>
          <input
            id="idea-goal"
            className="text-input"
            maxLength={300}
            placeholder="e.g. get more weekend customers, launch our new cake range"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") get();
            }}
          />
          <div className="idea-actions">
            <button className="pill active" onClick={get} disabled={busy || mode === "locked"}>
              {busy ? "Thinking of ideas..." : ideas.length ? "Give me 5 new ideas" : "Give me 5 ideas"}
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
          {ideas.length > 0 && (
            <div className="director-cards idea-cards">
              {ideas.map((i, n) => (
                <IdeaCard key={`${i.title}-${n}`} idea={i} onUse={onUse} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "Make one like this for my brand": rewrites an example prompt, or fills a template's blanks, for the user's product. */
export function AdaptBox({
  brand,
  mode,
  kind,
  example,
  fields,
  onDone,
  onClose,
}: {
  brand: Brand;
  mode: AppMode;
  kind: "image" | "video";
  example: string;
  fields?: { key: string; label: string; placeholder: string }[];
  onDone: (out: { prompt?: string; fields?: Record<string, string> }) => void;
  onClose?: () => void;
}) {
  const [business, setBusiness] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBusiness(businessFor(brand));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go() {
    if (!business.trim()) {
      setError("Tell us your product or business first.");
      return;
    }
    setBusy(true);
    setError(null);
    save({ business });
    try {
      const out = await callIdeas({ mode: "adapt", business, example, kind, fields, brand: brandInfo(brand) });
      onDone(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="director-box adapt-box">
      <div className="director-head">
        <strong>✨ Make one like this for my brand</strong>
        {onClose && (
          <button className="link-btn" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <p className="muted small">We keep the same look, light and shape, and swap in your product.{hasBrand(brand) ? " Your brand kit colours and style are added too." : ""}</p>
      <div className="product-link-row">
        <input
          className="text-input"
          maxLength={400}
          aria-label="Your product or business"
          placeholder="Your product, e.g. a bamboo toothbrush in a kraft box"
          value={business}
          onChange={(e) => setBusiness(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <button className="pill active" onClick={go} disabled={busy || mode === "locked"}>
          {busy ? "Making it yours..." : "Make it mine"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
