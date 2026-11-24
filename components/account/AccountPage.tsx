"use client";

// The person's own account page: credits and what they were used for, their
// plan, their voice copy, signing out, and deleting the account.

import { useEffect, useState } from "react";
import Link from "next/link";
import { PLAN_NAMES, signOut, type Me } from "./Account";
import { clearDevice, SYNCED } from "./sync";
import { BRAND_NAME } from "@/lib/founding";
import { MONTHLY_CAP } from "@/lib/promise";

type Line = { at: number; type: string; credits: number; balance: number; what: string };

const when = (at: number) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const amount = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n) < 1 && n !== 0 ? Math.abs(n).toFixed(1) : Math.round(Math.abs(n) * 10) / 10}`;

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmVoice, setConfirmVoice] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/me?history=1", { cache: "no-store" }).catch(() => null);
    if (r?.status === 401) {
      window.location.href = "/signin?next=/account";
      return;
    }
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (!d?.user) return setError("We couldn't load your account. Please reload the page.");
    setMe(d.user);
    setLines(d.history ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function deleteVoice() {
    const r = await fetch("/api/me/voice", { method: "DELETE" }).catch(() => null);
    if (!r?.ok) return setError("We couldn't delete your voice copy. Please try again.");
    try {
      const raw = localStorage.getItem(SYNCED.talk);
      if (raw) {
        const t = JSON.parse(raw);
        delete t.voice;
        localStorage.setItem(SYNCED.talk, JSON.stringify(t));
      }
    } catch {
      // nothing saved here
    }
    setConfirmVoice(false);
    setDone("Your voice copy is deleted. It can't be used again. You can set up a new one any time in You, talking.");
    void load();
  }

  async function deleteAccount() {
    setDeleting(true);
    const r = await fetch("/api/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: confirmText }) }).catch(() => null);
    if (!r?.ok) {
      setDeleting(false);
      return setError("We couldn't delete your account. Please try again, or email us.");
    }
    clearDevice();
    window.location.href = "/?deleted=1";
  }

  if (error && !me)
    return (
      <div className="account-page">
        <p className="signin-error">{error}</p>
      </div>
    );
  if (!me)
    return (
      <div className="account-loading">
        <span className="spinner small" aria-hidden />
      </div>
    );

  return (
    <div className="account-page">
      <header className="account-head">
        <Link href="/studio" className="btn">
          ← Back to the studio
        </Link>
        <button className="btn" onClick={() => signOut()}>
          Sign out
        </button>
      </header>

      <h1>Your account</h1>
      <p className="muted">{me.email}</p>
      {done && <p className="signin-note">{done}</p>}
      {error && <p className="signin-error">{error}</p>}

      <section className="account-card">
        <div className="account-balance">
          <span className="account-big">{me.credits.toLocaleString()}</span>
          <span>credits left</span>
        </div>
        <p>
          Plan: <strong>{PLAN_NAMES[me.plan]}</strong>
          {me.founding ? " (Founding member)" : ""}
          {me.planUntil ? `, free until ${day(me.planUntil)}` : ""}.
        </p>
        <p className="muted small">
          Each job shows its price as an estimated range before it starts. Credits come off as each step starts, and any step that fails gives its credits
          straight back. Buying more credits is coming soon{me.admin ? "" : `. If you run low, reply to your invite email and we'll top you up`}.
        </p>
        <p className="muted small">
          Automatic refunds and free remakes used this month: {me.promiseUsed} of {MONTHLY_CAP}.
        </p>
      </section>

      <section className="account-card">
        <h2>Where your credits went</h2>
        {lines.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <table className="account-table">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="muted">{when(l.at)}</td>
                  <td>{l.what}</td>
                  <td className={l.credits >= 0 ? "plus" : "minus"}>{amount(l.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="account-card">
        <h2>Your voice copy</h2>
        {me.voice ? (
          <>
            <p>
              You set up a copy of your voice for You, talking on {new Date(me.voice.at).toLocaleDateString()}. Only you can use it, and only in your own videos.
            </p>
            {!confirmVoice ? (
              <button className="btn btn-danger" onClick={() => setConfirmVoice(true)}>
                Delete my voice copy
              </button>
            ) : (
              <div className="account-confirm">
                <p>Delete it for good? Videos you already made stay in your gallery. To use You, talking again you would record your voice again (about 130 to 150 credits).</p>
                <button className="btn btn-danger" onClick={deleteVoice}>
                  Yes, delete my voice copy
                </button>{" "}
                <button className="btn" onClick={() => setConfirmVoice(false)}>
                  Keep it
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted">You haven&apos;t set up a voice copy. If you do, you can delete it here at any time.</p>
        )}
      </section>

      <section className="account-card danger-zone">
        <h2>Delete your account</h2>
        <p>
          This deletes your account, your credits and everything saved with it: your gallery list, Brand kit, references, ideas, chat, voice copy and any
          ElevenLabs connection. It can&apos;t be undone, and unused credits can&apos;t be given back.
        </p>
        <label className="signin-label" htmlFor="confirm-delete">
          Type DELETE to confirm
        </label>
        <input id="confirm-delete" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" autoComplete="off" />
        <button className="btn btn-danger" disabled={deleting || confirmText.trim().toUpperCase() !== "DELETE"} onClick={deleteAccount}>
          {deleting ? "Deleting…" : `Delete my ${BRAND_NAME} account`}
        </button>
      </section>
    </div>
  );
}
