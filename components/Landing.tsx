"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BRAND_LOGO, BRAND_LOGO_SIZE, BRAND_NAME, LOGO_HAS_NAME, OFFER, TOTAL_SPOTS } from "@/lib/founding";
import { COPYRIGHT_NOTICE } from "@/lib/appBrand";
import { dealColumns, makeLink, STUDIO_OPEN, STUDIO_PATH, templateLink, WALL, WALL_FILTERS, wallIn, type WallGroup, type WallItem } from "@/lib/landing";
import { TEMPLATE_MEDIA } from "@/lib/showcase";
import { sizeLabel, TEMPLATES } from "@/lib/templates";

// Public landing page: a moving wall of real results first, then a wall to
// scroll through, then templates and the Create page one step further in.
// Wall videos are silent and play once each time they scroll into view; the
// viewer plays them once with sound and a Replay button (never on a loop).

const CLAIM = "/founding#claim";
const START = STUDIO_OPEN ? `${STUDIO_PATH}?view=create` : CLAIM;
const HERO_COLUMNS = 5;

export default function Landing({ signIn = false }: { signIn?: boolean }) {
  const [filter, setFilter] = useState<WallGroup | "all">("all");
  const [open, setOpen] = useState<WallItem | null>(null);
  const shown = wallIn(filter);
  const columns = dealColumns(WALL, HERO_COLUMNS);

  return (
    <div className="landing">
      <header className="l-top">
        <Link href="/" className="l-brand" aria-label={`${BRAND_NAME} home`}>
          {BRAND_LOGO ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={LOGO_HAS_NAME ? "l-brand-logo" : undefined} src={BRAND_LOGO} alt="" {...BRAND_LOGO_SIZE} />
          ) : null}
          {!(BRAND_LOGO && LOGO_HAS_NAME) && <span>{BRAND_NAME}</span>}
        </Link>
        <nav className="l-nav" aria-label="Page sections">
          <a href="#examples">Examples</a>
          <a href="#templates">Templates</a>
          <a href="#create">Create</a>
        </nav>
        {signIn && (
          <Link href="/signin" className="l-signin">
            Sign in
          </Link>
        )}
        <Link href={CLAIM} className="generate small l-top-cta">
          Claim a founding spot
        </Link>
      </header>

      <section className="l-hero">
        <div className="l-wall" aria-hidden>
          {columns.map((col, c) => (
            <div className={`l-col l-col-${c}`} key={c} style={{ animationDuration: `${70 + ((c * 17) % 40)}s` }}>
              {[...col, ...col].map((item, i) => (
                <WallMedia key={`${item.src}-${i}`} item={item} eager={i < 3} className="l-wall-tile" />
              ))}
            </div>
          ))}
        </div>
        <div className="l-scrim" aria-hidden />
        <div className="l-hero-text">
          <p className="l-kicker">Everything here was made with {BRAND_NAME}</p>
          <h1>
            Pictures and video ads that stop the scroll, <em>from one sentence</em>
          </h1>
          <p className="l-lede">
            Describe it, drop in your product photo, or start from a template. {BRAND_NAME} picks the right AI model for the
            job and shows you an estimated price before anything is made.
          </p>
          <div className="l-hero-actions">
            <Link href={CLAIM} className="generate small">
              Claim a founding spot
            </Link>
            <a href="#examples" className="l-ghost">
              See what it makes ↓
            </a>
          </div>
          <p className="l-fine">
            First {TOTAL_SPOTS} people get {OFFER.freeMonths} month of {OFFER.freePlan} free. No card needed.
          </p>
        </div>
      </section>

      <section className="l-section" id="examples">
        <div className="l-head">
          <div>
            <h2>Made with {BRAND_NAME}</h2>
            <p className="muted">Real results, straight from the app. Tap any one to see it bigger.</p>
          </div>
          <div className="pills" role="tablist" aria-label="Show examples">
            {WALL_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`pill ${filter === f.id ? "active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="l-masonry">
          {shown.map((item) => (
            <button key={item.src} type="button" className="l-card" onClick={() => setOpen(item)}>
              <WallMedia item={item} className="l-card-media" />
              <span className="l-card-cap">
                <span className="tag">{item.kind === "video" ? "▶ Video" : item.label}</span>
                <span className="l-card-what">{item.what}</span>
              </span>
            </button>
          ))}
        </div>
        {filter === "video" && shown.length < 4 ? (
          <p className="muted l-more">More videos are on the way.</p>
        ) : null}
      </section>

      <section className="l-section" id="templates">
        <div className="l-head">
          <div>
            <h2>Start from a template</h2>
            <p className="muted">Fill in a blank or two and it comes out at the right size for where it&apos;s going.</p>
          </div>
        </div>
        <div className="l-templates">
          {TEMPLATES.map((t) => {
            const media = TEMPLATE_MEDIA[t.id];
            return (
              <Link key={t.id} href={templateLink(t.id)} className="l-tpl">
                <span className="l-tpl-art">
                  {media?.kind === "video" ? (
                    <video src={media.src} muted playsInline preload="metadata" />
                  ) : media ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.src} alt="" loading="lazy" />
                  ) : null}
                  {t.size ? <span className="tag l-tpl-size">{sizeLabel(t.size)}</span> : null}
                </span>
                <span className="l-tpl-name">{t.name}</span>
                <span className="muted l-tpl-use">{t.use}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="l-section l-create" id="create">
        <div>
          <h2>Or just describe it</h2>
          <p className="muted">The Create page keeps it to four steps, and you always know whether you&apos;re making a picture or a video.</p>
          <ol className="l-steps">
            <li>
              <strong>Picture, video or a full ad.</strong> A full ad plans the scenes with you, then adds a voiceover and music.
            </li>
            <li>
              <strong>Describe it, or pick a template.</strong> Add your product photo or logo if you want it in the result.
            </li>
            <li>
              <strong>Check the options.</strong> Shape, length and sound are set for you, and you can change them.
            </li>
            <li>
              <strong>See the estimated price, then make it.</strong> Ask for changes in plain words afterwards.
            </li>
          </ol>
          <Link href={START} className="generate small l-create-cta">
            {STUDIO_OPEN ? "Start creating" : "Claim a founding spot to start"}
          </Link>
        </div>
        <div className="l-mock" aria-hidden>
          <div className="l-mock-kinds">
            <span className="pill">Picture</span>
            <span className="pill active">Video</span>
            <span className="pill">Full ad</span>
          </div>
          <div className="l-mock-prompt">
            A sneaker turning slowly on a neon-lit stand, rain running down the window behind it<span className="l-caret" />
          </div>
          <div className="l-mock-result">
            <WallMedia item={WALL[0]} className="l-mock-media" />
          </div>
        </div>
      </section>

      <section className="l-band">
        <h2>Be one of the first {TOTAL_SPOTS}</h2>
        <p className="muted">
          Founding members get {OFFER.freeMonths} month of {OFFER.freePlan} free ({OFFER.freeCredits} credits), a founding
          price if they stay, and a direct line to the people building it.
        </p>
        <Link href={CLAIM} className="generate small">
          Claim a founding spot
        </Link>
      </section>

      <footer className="l-foot muted small">
        <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> ·{" "}
        <Link href="/acceptable-use">Acceptable use</Link> · <a href={STUDIO_PATH}>Members: open the studio</a>
        <span className="l-foot-legal">{COPYRIGHT_NOTICE}</span>
      </footer>

      {open ? <Viewer item={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** A picture, or a silent video that plays once each time it scrolls into view. */
function WallMedia({ item, className, eager }: { item: WallItem; className?: string; eager?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (v.ended) v.currentTime = 0;
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  if (item.kind === "video") {
    return <video ref={ref} className={className} src={item.src} muted playsInline preload="metadata" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={item.src} alt={item.what} loading={eager ? "eager" : "lazy"} decoding="async" />;
}

/** The bigger view: videos play once with sound and offer Replay. */
function Viewer({ item, onClose }: { item: WallItem; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function replay() {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    setEnded(false);
    v.play().catch(() => {});
  }

  return (
    <div className="l-viewer" role="dialog" aria-modal="true" aria-label={item.label} onClick={onClose}>
      <div className="l-viewer-box" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="l-viewer-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="l-viewer-media">
          {item.kind === "video" ? (
            <>
              <video ref={video} src={item.src} autoPlay playsInline controls onEnded={() => setEnded(true)} onPlay={() => setEnded(false)} />
              {ended ? (
                <button type="button" className="l-replay" onClick={replay}>
                  ↻ Replay
                </button>
              ) : null}
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.src} alt={item.what} />
          )}
        </div>
        <div className="l-viewer-side">
          <span className="tag">{item.kind === "video" ? "Video" : item.label}</span>
          <p>{item.what}</p>
          <Link href={makeLink(item)} className="generate small">
            Make one like this
          </Link>
          {!STUDIO_OPEN ? <p className="muted small">We&apos;re opening to founding members first. Claim a spot and we&apos;ll email you when yours is ready.</p> : null}
        </div>
      </div>
    </div>
  );
}
