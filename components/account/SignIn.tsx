"use client";

// Signing in, three ways, none with a password to remember:
//  - "Continue with Google" (when it's set up in Netlify)
//  - an email with a 6-digit code
//  - a passkey (fingerprint, face or screen lock), which people can add right
//    after signing in the first time, for faster sign-in next time.
// Invite-only until launch, whichever way they use.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { addPasskeyHere } from "./passkey";
import { BRAND_LOGO, BRAND_LOGO_SIZE, BRAND_NAME, LOGO_HAS_NAME } from "@/lib/founding";

/** "Not now" on the passkey offer is remembered on this device for 30 days. */
const SKIP_KEY = "tf_passkey_skip";
const SKIP_DAYS = 30;

function skippedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(SKIP_KEY));
    return at > 0 && Date.now() - at < SKIP_DAYS * 86400_000;
  } catch {
    return false;
  }
}

function nextPage(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/studio";
}

export default function SignIn({ google = false }: { google?: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "passkey">("email");
  const [canPasskey, setCanPasskey] = useState(false);
  const [googleHref, setGoogleHref] = useState("/api/auth/google");
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
    if (q.get("next")) setGoogleHref(`/api/auth/google?next=${encodeURIComponent(nextPage())}`);
    const webauthn = browserSupportsWebAuthn();
    setCanPasskey(webauthn);
    const g = q.get("google");
    if (g === "not-invited") {
      setError("ToastyFly is invite-only for now, and this Google account's email isn't on the list yet.");
      setNotInvited(true);
    } else if (g === "again") setError("Google sign-in didn't finish. Please try again, or use your email.");
    else if (g === "cancelled") setNote("Google sign-in was cancelled. You can try again, or use your email.");
    // Just signed in with Google: offer a passkey once, or go straight on.
    if (q.get("signedin")) {
      if (!webauthn || q.get("pk") || skippedRecently()) window.location.replace(nextPage());
      else setStep("passkey");
    }
  }, []);

  function goOn() {
    window.location.href = nextPage();
  }

  async function passkeySignIn() {
    setBusy(true);
    setError(null);
    setNotInvited(false);
    setNote(null);
    try {
      const r = await fetch("/api/auth/passkey/options", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error ?? "Something went wrong. Please try again.");
      const response = await startAuthentication({ optionsJSON: d.options });
      const v = await fetch("/api/auth/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: d.challengeId, response }),
      });
      const vd = await v.json().catch(() => ({}));
      if (!v.ok) return setError(vd.error ?? "That passkey didn't work. Please try again.");
      goOn();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "AbortError")
        setNote("No passkey was used. If you haven't added one yet, sign in with Google or your email first.");
      else setError("Passkeys didn't work on this device. Please sign in with Google or your email.");
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);
    const err = await addPasskeyHere();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setNote("Passkey added. Next time, just tap “Sign in with a passkey”.");
    setTimeout(goOn, 1200);
  }

  function skipPasskey() {
    try {
      localStorage.setItem(SKIP_KEY, String(Date.now()));
    } catch {
      // nothing saved here
    }
    goOn();
  }

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
      // First time on this device without a passkey: offer one for next time.
      if (canPasskey && !d.passkeys && !skippedRecently()) {
        setStep("passkey");
        return;
      }
      goOn();
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

        {step === "passkey" ? (
          <div className="signin-offer">
            <h1>Sign in faster next time?</h1>
            <p className="muted">
              Add a passkey and next time you just use your fingerprint, face or screen lock. No code to wait for, and nothing to remember.
            </p>
            {note && <p className="signin-note">{note}</p>}
            <button className="generate" onClick={addPasskey} disabled={busy}>
              {busy ? "Waiting for your device…" : "Add a passkey"}
            </button>
            <button type="button" className="signin-alt" onClick={skipPasskey} disabled={busy}>
              Not now
            </button>
          </div>
        ) : step === "email" ? (
          <form onSubmit={sendCode}>
            <h1>Sign in</h1>
            <p className="muted">Use Google, a passkey or your email. No password needed.</p>
            {note && <p className="signin-note">{note}</p>}
            {google && (
              <a className="signin-alt signin-google" href={googleHref}>
                <GoogleMark />
                Continue with Google
              </a>
            )}
            {canPasskey && (
              <button type="button" className="signin-alt" onClick={passkeySignIn} disabled={busy}>
                <KeyMark />
                Sign in with a passkey
              </button>
            )}
            {(google || canPasskey) && <p className="signin-or">or get a code by email</p>}
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

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function KeyMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2" />
    </svg>
  );
}
