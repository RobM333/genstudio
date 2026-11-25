"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND_LOGO, BRAND_LOGO_SIZE, BRAND_NAME, cleanRefCode, LOGO_HAS_NAME, MAKES, OFFER, REFERRAL, spotsLine, TOTAL_SPOTS } from "@/lib/founding";
import { FREE_MONTH_MAKES, foundingPriceShort, SHARE_LINE } from "@/lib/foundingOffer";

// Public "Founding 100" sign-up page. Works without the app password.
// Sign-ups go to /api/founding (kept in Netlify Blobs) and a copy goes to
// Netlify Forms, so they also show in the Netlify dashboard.

type Example = { src: string; kind: "image" | "video"; label: string; what: string };

// Real results made with the app (files from scripts/fetch-showcase.mjs).
const EXAMPLES: Example[] = [
  { src: "/showcase/product-hero.jpg", kind: "image", label: "Product photo", what: "A frosted glass perfume bottle on wet black stone" },
  { src: "/showcase/reveal.mp4", kind: "video", label: "Video", what: "A sneaker turning on a neon-lit stand, rain outside" },
  { src: "/showcase/lifestyle.jpg", kind: "image", label: "Lifestyle", what: "A coffee shop at golden hour, film look" },
  { src: "/showcase/rocket.jpg", kind: "image", label: "Illustration", what: "A rocket made of sneakers, bold flat colours" },
  { src: "/showcase/teams-background.jpg", kind: "image", label: "Call background", what: "A branded Microsoft Teams background" },
  { src: "/showcase/zoom-background.jpg", kind: "image", label: "Call background", what: "A branded Zoom background" },
];

const PERKS = [
  {
    title: `${OFFER.freeMonths} month of ${OFFER.freePlan}, free`,
    text: `${OFFER.freeCredits} credits to use with every model in the app. That makes ${FREE_MONTH_MAKES}. No card needed.`,
  },
  {
    title: "A founding price after that",
    text: `If you decide to stay, you keep a founding price for as long as you stay, planned at ${OFFER.foundingDiscount} off: ${foundingPriceShort("creator")}, or ${foundingPriceShort("pro")}. These are estimates. We confirm the exact price before you pay anything.`,
  },
  {
    title: "Bonus credits for sharing",
    text: `You get your own invite link. ${SHARE_LINE}`,
  },
  {
    title: "A direct line to us",
    text: "Tell us what works and what doesn't, and talk to the people building it, not a bot.",
  },
];

const STEPS = [
  "Leave your email below to hold your spot. You'll get your own invite link to share if you like.",
  "We invite founding members in small groups as accounts open. We'll email you when yours is ready.",
  `Use your free month and its ${OFFER.freeCredits} credits. If you like what you made, we'd be grateful for an honest review or a result we can show. Only if you want to.`,
  `A few days before the month ends, we'll send you a short note with your founding price. If you don't stay, you move to the ${OFFER.afterPlan} plan (${OFFER.afterCredits} credits a month) and keep everything you made.`,
];

const NOTES = [
  {
    q: "Do I have to pay anything?",
    a: "No. Claiming a spot is free and we don't ask for a card, so nobody is charged by surprise. After your free month you choose whether to stay. Nothing renews by itself.",
  },
  {
    q: "Is the free month unlimited?",
    a: `No. It's the ${OFFER.freePlan} plan with ${OFFER.freeCredits} credits, which makes ${FREE_MONTH_MAKES}. Every job shows its estimated credits before it starts. When the credits are used up, new jobs stop until you choose a plan, and you can still see and download everything you made.`,
  },
  {
    q: "How do the bonus credits for friends work?",
    a: `Share your personal link. When a friend joins with it, you each get ${REFERRAL.bonus} bonus credits once you both have accounts, for up to ${REFERRAL.maxFriends} friends. Your own second email doesn't count, and nor do throwaway inboxes.`,
  },
  {
    q: "When can I start?",
    a: "We're finishing accounts now and will invite people in small groups. We won't give a date we can't keep, so we'll email you as soon as your spot is ready.",
  },
  {
    q: "What will you do with my email?",
    a: "Only use it to invite you and talk to you about your founding spot. We never sell it. Ask us any time and we'll remove it.",
  },
];

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; already: boolean; number: number | null; refCode: string | null }
  | { kind: "error"; message: string };

export default function Founding() {
  const [left, setLeft] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [makes, setMakes] = useState("");
  const [agree, setAgree] = useState(false);
  const [website, setWebsite] = useState(""); // hidden from people, catches bots
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [ref, setRef] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Came through a friend's invite link?
    try {
      const fromUrl = cleanRefCode(new URLSearchParams(window.location.search).get("ref"));
      if (fromUrl) {
        setRef(fromUrl);
        sessionStorage.setItem("tf_ref", fromUrl);
      } else setRef(cleanRefCode(sessionStorage.getItem("tf_ref")));
    } catch {
      // no storage: the link in the address bar is enough
    }
    fetch("/api/founding", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLeft(typeof d.left === "number" ? d.left : null))
      .catch(() => {});
  }, []);

  const full = left !== null && left <= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/founding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, makes, agree, website, ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }
      if (typeof data.left === "number") setLeft(data.left);
      if (data.status === "added") {
        // Copy to Netlify Forms so it also shows (and can email the owner) in the Netlify dashboard.
        fetch("/__forms.html", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ "form-name": "founding", email, name, makes }).toString(),
        }).catch(() => {});
      }
      setStatus({
        kind: "done",
        already: data.status === "already",
        number: typeof data.number === "number" ? data.number : null,
        refCode: cleanRefCode(data.refCode),
      });
    } catch {
      setStatus({ kind: "error", message: "We couldn't reach the server. Please check your connection and try again." });
    }
  }

  const doneTitle =
    status.kind === "done"
      ? status.already
        ? "You're already on the list"
        : status.number !== null && status.number > TOTAL_SPOTS
          ? "You're on the waitlist"
          : "Your founding spot is held"
      : "";

  return (
    <div className="founding">
      <div className="aurora" aria-hidden />
      <header className="founding-top">
        <Link href="/" aria-label={`${BRAND_NAME}: see examples`}>
          {BRAND_LOGO ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={LOGO_HAS_NAME ? "founding-logo founding-logo-named" : "founding-logo"} src={BRAND_LOGO} alt={BRAND_NAME} {...BRAND_LOGO_SIZE} />
          ) : (
            <span className="founding-brand">{BRAND_NAME}</span>
          )}
        </Link>
        <span className="badge badge-live">
          <span className="badge-dot" /> Opening soon
        </span>
      </header>

      <section className="founding-hero">
        <div className="founding-intro">
          <p className="founding-kicker">The Founding {TOTAL_SPOTS}</p>
          <h1>
            Pictures and video ads, <em>made with you</em>
          </h1>
          <p className="founding-lede">
            {BRAND_NAME} turns a sentence, a product photo or your brand into images and videos, using today&apos;s best
            AI models in one place. We&apos;re opening to our first {TOTAL_SPOTS} members, and we&apos;d like you to be one.
          </p>
          <ul className="founding-perks-short">
            <li>✓ {OFFER.freeMonths} month of {OFFER.freePlan} free ({OFFER.freeCredits} credits)</li>
            <li>✓ A founding price if you stay, no card needed now</li>
            <li>✓ {REFERRAL.bonus} bonus credits for each friend you bring (up to {REFERRAL.maxFriends})</li>
            <li>✓ A direct line to the people building it</li>
          </ul>
        </div>

        <div className="founding-card" id="claim">
          {status.kind === "done" ? (
            <div className="founding-done" role="status">
              <div className="founding-check" aria-hidden>✓</div>
              <h2>{doneTitle}</h2>
              <p className="muted">
                {status.already
                  ? "That email already has a spot. We'll be in touch when it's ready."
                  : status.number !== null && status.number > TOTAL_SPOTS
                    ? "All founding spots were taken, so you're first in line for what comes next. We'll email you."
                    : "We'll email you when your account is ready. Nothing to pay, nothing else to do for now."}
              </p>
              {status.refCode ? (
                <div className="founding-share">
                  <p className="small">
                    <strong>Your invite link</strong>
                  </p>
                  <code>{`${window.location.origin}/founding?ref=${status.refCode}`}</code>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${window.location.origin}/founding?ref=${status.refCode}`);
                      setCopied(true);
                    }}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <p className="muted small">{SHARE_LINE} The credits are added once you both have accounts.</p>
                </div>
              ) : (
                <p className="muted small">Know someone who&apos;d use it? Send them this page.</p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} noValidate={false}>
              <div className="founding-spots" aria-live="polite">
                {left === null ? (
                  <span className="muted">{TOTAL_SPOTS} founding spots</span>
                ) : (
                  <>
                    <strong>{spotsLine(left)}</strong>
                    <span className="founding-meter" aria-hidden>
                      <span style={{ width: `${Math.round(((TOTAL_SPOTS - left) / TOTAL_SPOTS) * 100)}%` }} />
                    </span>
                  </>
                )}
              </div>
              <h2>{full ? "Join the waitlist" : "Claim a founding spot"}</h2>
              {ref && (
                <p className="founding-friend">
                  A friend sent you this link. Once you both have accounts, you each get {REFERRAL.bonus} bonus credits.
                </p>
              )}
              <label className="founding-field">
                <span>Email</span>
                <input type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="founding-field">
                <span>
                  First name <em className="muted">optional</em>
                </span>
                <input type="text" autoComplete="given-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="founding-field">
                <span>
                  What would you make first? <em className="muted">optional</em>
                </span>
                <select value={makes} onChange={(e) => setMakes(e.target.value)}>
                  <option value="">Choose one</option>
                  {MAKES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="founding-hp" aria-hidden>
                Leave this empty
                <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
              <label className="founding-agree">
                <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  Email me about my founding spot. I can ask to be removed any time. See the{" "}
                  <Link href="/privacy" target="_blank">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
              {status.kind === "error" && (
                <p className="founding-error" role="alert">
                  {status.message}
                </p>
              )}
              <button type="submit" className="generate small" disabled={status.kind === "sending"}>
                {status.kind === "sending" ? "Saving your spot…" : full ? "Join the waitlist" : "Claim my founding spot"}
              </button>
              <p className="muted small founding-fine">Free to claim. No card, so nothing can be charged. No launch date promised.</p>
            </form>
          )}
        </div>
      </section>

      <section className="founding-section">
        <h2>Made with {BRAND_NAME}</h2>
        <p className="muted">Real results from the app, not mock-ups.</p>
        <div className="founding-gallery">
          {EXAMPLES.map((ex) => (
            <figure key={ex.src} className="founding-shot">
              {ex.kind === "video" ? (
                <video src={ex.src} muted playsInline autoPlay preload="metadata" aria-label={ex.what} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ex.src} alt={ex.what} loading="lazy" />
              )}
              <figcaption>
                <span className="tag">{ex.label}</span>
                <span>{ex.what}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="founding-section">
        <h2>What founding members get</h2>
        <div className="founding-perks">
          {PERKS.map((p) => (
            <div key={p.title} className="founding-perk">
              <h3>{p.title}</h3>
              <p className="muted">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="founding-section founding-two">
        <div>
          <h2>How it works</h2>
          <ol className="founding-steps">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h2>Honest answers</h2>
          {NOTES.map((n) => (
            <div key={n.q} className="founding-note">
              <h3>{n.q}</h3>
              <p className="muted">{n.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="founding-cta">
        <a href="#claim" className="generate small">
          {full ? "Join the waitlist" : "Claim a founding spot"}
        </a>
      </section>

      <footer className="founding-foot muted small">
        © {BRAND_NAME} · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> ·{" "}
        <Link href="/acceptable-use">Acceptable use</Link>
      </footer>
    </div>
  );
}
