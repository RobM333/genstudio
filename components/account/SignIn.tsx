"use client";

// Signing in with just an email: we send a 6-digit code, they type it in.
// No password to remember. Invite-only until launch.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BRAND_LOGO, BRAND_LOGO_SIZE, BRAND_NAME, LOGO_HAS_NAME } from "@/lib/founding";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notInvited, setNotInvited] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const codeBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("email");
    if (e) setEmail(e);
    if (q.get("out")) setNote("You're signed out. Your work is saved in your account.");
  }, []);

  useEffect(() => {
    if (step === "code") codeBox.current?.focus();
  }, [step]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotInvited(false);
    setNote(null);
    try {
      const r = await fetch("/api/auth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "Something went wrong. Please try again.");
        setNotInvited(Boolean(d.notInvited));
        return;
      }
      setStep("code");
      setCode("");
    } catch {
      setError("We couldn't reach ToastyFly. Please check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "That code didn't work.");
        if (d.expired) setStep("email");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") ?? "";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/studio";
    } catch {
      setError("We couldn't reach ToastyFly. Please check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <Link href="/" className="signin-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={LOGO_HAS_NAME ? "signin-logo-named" : undefined} src={BRAND_LOGO} alt={LOGO_HAS_NAME ? BRAND_NAME : ""} {...BRAND_LOGO_SIZE} />
          {!(BRAND_LOGO && LOGO_HAS_NAME) && <span>{BRAND_NAME}</span>}
        </Link>

        {step === "email" ? (
          <form onSubmit={sendCode}>
            <h1>Sign in</h1>
            <p className="muted">Type your email and we&apos;ll send you a 6-digit code. No password needed.</p>
            {note && <p className="signin-note">{note}</p>}
            <label className="signin-label" htmlFor="signin-email">
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <button className="generate" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </form>
        ) : (
          <form onSubmit={checkCode}>
            <h1>Check your email</h1>
            <p className="muted">
              We sent a 6-digit code to <strong>{email}</strong>. It works for 10 minutes. If it isn&apos;t there, look in your spam folder.
            </p>
            <label className="signin-label" htmlFor="signin-code">
              Code
            </label>
            <input
              id="signin-code"
              ref={codeBox}
              className="signin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
              placeholder="123456"
            />
            <button className="generate" disabled={busy || code.replace(/\D/g, "").length !== 6}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <p className="signin-again">
              <button type="button" className="link-btn" onClick={() => sendCode()} disabled={busy}>
                Send a new code
              </button>{" "}
              ·{" "}
              <button type="button" className="link-btn" onClick={() => setStep("email")} disabled={busy}>
                Use a different email
              </button>
            </p>
          </form>
        )}

        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        {notInvited && (
          <p className="signin-note">
            <Link href="/founding#claim">Claim a Founding spot</Link> and we&apos;ll email you an invite as soon as yours is ready.
          </p>
        )}
        <p className="signin-foot">
          By signing in you agree to our <Link href="/terms">Terms</Link> and <Link href="/acceptable-use">Acceptable use</Link>, and you can read our{" "}
          <Link href="/privacy">Privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}
