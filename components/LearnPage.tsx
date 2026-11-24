"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MIN_PEOPLE, MIN_REPORTS, PROBLEMS, type LearnSummary, type RuleView } from "@/lib/learn";
import { getModel } from "@/lib/models";

// The owner's page for "learn from every fix". Shows what keeps going wrong,
// the ready-made rules that enough people's fixes point to, and an on/off
// switch for each. Nothing here costs anything.

const kindWord = (k: string) => (k === "image" ? "Pictures" : "Videos");
const modelName = (id: string) => getModel(id)?.name ?? id.split("/").slice(-2).join(" ");
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export default function LearnPage() {
  const [data, setData] = useState<LearnSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState({ kind: "image", problem: "", text: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/learn", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't load.");
      setData(j as LearnSummary);
    } catch (e) {
      setError((e as Error).message || "Couldn't load.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, string>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "That didn't work.");
      setData(j as LearnSummary);
      if (body.action === "add") setDraft({ kind: draft.kind, problem: "", text: "" });
    } catch (e) {
      setError((e as Error).message || "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  const suggested = data?.rules.filter((r) => r.status === "suggested") ?? [];
  const on = data?.rules.filter((r) => r.status === "on") ?? [];
  const rest = data?.rules.filter((r) => r.status === "off" || r.status === "waiting") ?? [];

  return (
    <div className="pricing learn">
      <Link href="/" className="legal-back">
        ← Back to the studio
      </Link>
      <header className="learn-head">
        <h1>
          Learn from every <em>fix</em>
        </h1>
        <p className="muted">
          Each time someone fixes, remakes or flags a result, we note what kind of problem it was (never who they are). When the same problem keeps
          coming up for different people, a ready-made rule for it shows up here. Once you turn it on, the prompt helper follows it for every new
          prompt of that kind. You can switch any rule off again at any time.
        </p>
      </header>

      {error && <div className="notice warn">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="learn-totals">
            <Stat n={data.totals.results} label="results made" />
            <Stat n={data.totals.reports} label="fixes, remakes and flags" />
            <Stat n={data.totals.people} label="different people" />
            <Stat n={data.totals.thumbsUp} label="👍" />
            <Stat n={data.totals.thumbsDown} label="👎" />
          </div>
          <p className="muted small">Last {data.windowDays} days.</p>

          <section className="learn-section">
            <h2>Waiting for your OK {suggested.length > 0 && <span className="learn-count">{suggested.length}</span>}</h2>
            {suggested.length === 0 ? (
              <p className="muted">
                Nothing yet. A rule is suggested once its problem was reported on at least {MIN_REPORTS} results by at least {MIN_PEOPLE} different
                people, so one person&apos;s unusual request can&apos;t change results for everyone.
              </p>
            ) : (
              suggested.map((r) => (
                <RuleCard key={r.id} r={r}>
                  <button className="btn btn-light" disabled={busy === r.id} onClick={() => act({ action: "on", id: r.id }, r.id)}>
                    Turn on
                  </button>
                  <button className="btn" disabled={busy === r.id} onClick={() => act({ action: "skip", id: r.id }, r.id)}>
                    Not now
                  </button>
                </RuleCard>
              ))
            )}
          </section>

          <section className="learn-section">
            <h2>On now {on.length > 0 && <span className="learn-count">{on.length}</span>}</h2>
            {on.length === 0 ? (
              <p className="muted">No rules are on, so the prompt helper works exactly as it did before.</p>
            ) : (
              on.map((r) => (
                <RuleCard key={r.id} r={r}>
                  <button className="btn" disabled={busy === r.id} onClick={() => act({ action: "off", id: r.id }, r.id)}>
                    Switch off
                  </button>
                  {r.custom && (
                    <button className="btn btn-danger" disabled={busy === r.id} onClick={() => act({ action: "delete", id: r.id }, r.id)}>
                      Delete
                    </button>
                  )}
                </RuleCard>
              ))
            )}
          </section>

          <section className="learn-section">
            <h2>What keeps going wrong</h2>
            {data.problems.length === 0 ? (
              <p className="muted">No problems reported yet.</p>
            ) : (
              <div className="learn-table" role="table">
                <div className="learn-row learn-row-head" role="row">
                  <span>Problem</span>
                  <span>For</span>
                  <span>Results</span>
                  <span>People</span>
                  <span>Mostly with</span>
                </div>
                {data.problems.map((p) => (
                  <div className="learn-row" role="row" key={`${p.problem}:${p.kind}`}>
                    <span>{p.label}</span>
                    <span>{kindWord(p.kind)}</span>
                    <span>{p.reports}</span>
                    <span>{p.people}</span>
                    <span className="muted">{p.topModels.map((m) => modelName(m.model)).join(", ")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="learn-section">
            <h2>Comments we couldn&apos;t sort</h2>
            <p className="muted small">
              What people typed when it didn&apos;t match a known problem. Contact details and links are removed, and these are deleted after 30 days.
              They are only shown here, never added to anyone&apos;s prompt. If you see a pattern, write a rule for it below.
            </p>
            {data.comments.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul className="learn-comments">
                {data.comments.map((c, i) => (
                  <li key={i}>
                    <span className="muted small">
                      {day(c.at)} · {c.kind}
                    </span>{" "}
                    “{c.note}”
                  </li>
                ))}
              </ul>
            )}
            <form
              className="learn-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "add", kind: draft.kind, problem: draft.problem, text: draft.text }, "add");
              }}
            >
              <strong>Write your own rule</strong>
              <div className="learn-form-row">
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} aria-label="For">
                  <option value="image">For pictures</option>
                  <option value="video">For videos</option>
                </select>
                <select value={draft.problem} onChange={(e) => setDraft({ ...draft, problem: e.target.value })} aria-label="Problem it fixes">
                  <option value="">Problem it fixes (optional, lets us measure it)</option>
                  {PROBLEMS.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={2}
                maxLength={300}
                placeholder="For example: Keep product photos on a plain, light background unless the person asks for a scene."
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
              <button className="btn btn-light" disabled={busy === "add" || draft.text.trim().length < 10}>
                Add and turn on
              </button>
            </form>
          </section>

          <section className="learn-section">
            <button className="btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Hide" : "Show"} all {rest.length} ready-made rules
            </button>
            {showAll && (
              <>
                <p className="muted small">
                  These haven&apos;t been reported enough yet (or you said Not now). You can turn one on anyway, but we can only tell whether it helps
                  once its problem has been reported.
                </p>
                {rest.map((r) => (
                  <RuleCard key={r.id} r={r}>
                    <button className="btn" disabled={busy === r.id} onClick={() => act({ action: "on", id: r.id }, r.id)}>
                      Turn on anyway
                    </button>
                  </RuleCard>
                ))}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="learn-stat">
      <strong>{n}</strong>
      <span className="muted small">{label}</span>
    </div>
  );
}

function RuleCard({ r, children }: { r: RuleView; children: React.ReactNode }) {
  return (
    <div className="learn-card">
      <div className="learn-card-top">
        <strong>{r.label}</strong>
        <span className="learn-tag">{kindWord(r.kind)}</span>
        {r.custom && <span className="learn-tag">Your rule</span>}
      </div>
      <p className="learn-rule">“{r.text}”</p>
      <p className="muted small">
        {r.reports > 0 ? `Reported on ${r.reports} result${r.reports === 1 ? "" : "s"} by ${r.people} ${r.people === 1 ? "person" : "different people"}.` : "Not reported yet."}
        {r.onSince && ` On since ${day(r.onSince)}.`}
      </p>
      {r.status === "on" && r.before && r.after && (
        <p className="small learn-measure">
          {r.verdict?.startsWith("Not enough") ? (
            r.verdict
          ) : (
            <>
              Needed this fix: {r.before.rate} in every 100 results before ({r.before.results} results), {r.after.rate} in every 100 since ({r.after.results}{" "}
              results made with it). {r.verdict}
            </>
          )}
        </p>
      )}
      {r.status === "on" && !r.before && r.custom && <p className="muted small">Pick a problem when writing a rule to see whether it helps.</p>}
      <div className="learn-actions">{children}</div>
    </div>
  );
}
