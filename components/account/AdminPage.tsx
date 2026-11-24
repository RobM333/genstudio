"use client";

// The owner's page: invite the Founding 100 from the sign-up list (each gets 1
// month of Creator with 500 credits), invite anyone else, and see everyone's
// credits. Only the emails in ADMIN_EMAILS can open it.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOUNDING_CREDITS_SHOWN } from "./shared";

type U = { id: string; email: string; name: string; credits: number; plan: string; planUntil: string | null; founding: boolean; createdAt: number; lastSignIn: number | null };
type I = { email: string; name: string; credits: number; founding: boolean; at: number; joined: boolean };
type S = { email: string; name: string; makes: string; at: string; spot: boolean };

const date = (at: number | string) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function AdminPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [invites, setInvites] = useState<I[]>([]);
  const [signups, setSignups] = useState<S[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; link?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [founding, setFounding] = useState(true);
  const [credits, setCredits] = useState("50");
  const [addFor, setAddFor] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const r = await fetch("/api/admin", { cache: "no-store" }).catch(() => null);
    if (r?.status === 401) {
      window.location.href = "/signin?next=/admin";
      return;
    }
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return setError(d.error ?? "Couldn't load the owner page.");
    setUsers(d.users ?? []);
    setInvites(d.invites ?? []);
    setSignups(d.signups ?? []);
    setLoaded(true);
  }
  useEffect(() => {
    void load();
  }, []);

  const invited = useMemo(() => new Map(invites.map((i) => [i.email, i])), [invites]);
  const joined = useMemo(() => new Set(users.map((u) => u.email)), [users]);

  async function sendInvite(to: string, opts: { name?: string; founding: boolean; credits?: number }) {
    setBusy(to);
    setMsg(null);
    setError(null);
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invite", email: to, ...opts }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) return setError(d.error ?? "The invite didn't work.");
    const what = opts.founding ? `1 month of Creator with ${FOUNDING_CREDITS_SHOWN} credits` : `${opts.credits ?? 0} credits`;
    if (d.existing) setMsg({ text: `${to} already has an account, so ${what} went straight onto it.` });
    else if (d.emailed) setMsg({ text: `Invite emailed to ${to} (${what}).` });
    else
      setMsg({
        text:
          d.emailProblem === "not-verified"
            ? `${to} is on the invite list (${what}), but the email couldn't be sent: Resend only sends to other people once your domain is set up there. Send them this link yourself:`
            : `${to} is on the invite list (${what}), but the email couldn't be sent. Send them this link yourself:`,
        link: d.link,
      });
    void load();
  }

  async function addCredits(u: U) {
    const n = Math.round(Number(addFor[u.id]));
    if (!n) return;
    setBusy(u.id);
    const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "credits", userId: u.id, credits: n }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) return setError(d.error ?? "Couldn't change the credits.");
    setAddFor((a) => ({ ...a, [u.id]: "" }));
    setMsg({ text: `${u.email} now has ${d.credits} credits.` });
    void load();
  }

  const foundingLeft = signups.filter((s) => s.spot && !invited.has(s.email) && !joined.has(s.email));

  return (
    <div className="account-page admin-page">
      <header className="account-head">
        <Link href="/studio" className="btn">
          ← Back to the studio
        </Link>
        <a className="btn" href="/api/founding/list">
          Download sign-up list
        </a>
      </header>
      <h1>Owner page</h1>
      <p className="muted">Invite people and see everyone&apos;s credits. Only you can see this page.</p>
      {error && <p className="signin-error">{error}</p>}
      {msg && (
        <p className="signin-note">
          {msg.text}
          {msg.link && (
            <>
              <br />
              <code className="admin-link">{msg.link}</code>{" "}
              <button className="link-btn" onClick={() => navigator.clipboard?.writeText(msg.link!)}>
                Copy
              </button>
            </>
          )}
        </p>
      )}

      <section className="account-card">
        <h2>Invite someone</h2>
        <div className="admin-form">
          <input type="email" placeholder="their@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="First name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="admin-check">
            <input type="radio" checked={founding} onChange={() => setFounding(true)} /> Founding member: 1 month of Creator, {FOUNDING_CREDITS_SHOWN} credits
          </label>
          <label className="admin-check">
            <input type="radio" checked={!founding} onChange={() => setFounding(false)} /> Free plan with{" "}
            <input className="admin-num" inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.replace(/\D/g, ""))} /> credits
          </label>
          <button
            className="generate"
            disabled={!email.trim() || busy !== null}
            onClick={() => {
              void sendInvite(email.trim(), { name: name.trim() || undefined, founding, credits: founding ? undefined : Number(credits) || 0 });
              setEmail("");
              setName("");
            }}
          >
            Send invite
          </button>
        </div>
      </section>

      <section className="account-card">
        <h2>Founding sign-ups</h2>
        <p className="muted small">
          {signups.filter((s) => s.spot).length} founding spots claimed, {foundingLeft.length} not invited yet. Inviting gives them 1 month of Creator with{" "}
          {FOUNDING_CREDITS_SHOWN} credits from the day they first sign in.
        </p>
        {loaded && signups.length === 0 && <p className="muted">No sign-ups yet.</p>}
        {signups.length > 0 && (
          <table className="account-table">
            <tbody>
              {signups.map((s, n) => {
                const inv = invited.get(s.email);
                const status = joined.has(s.email) ? "Joined" : inv ? `Invited ${date(inv.at)}` : null;
                return (
                  <tr key={s.email}>
                    <td className="muted">{n + 1}</td>
                    <td>
                      {s.email}
                      {s.name ? <span className="muted"> · {s.name}</span> : null}
                      {s.makes ? <span className="muted small"> · {s.makes}</span> : null}
                    </td>
                    <td className="muted small">{s.spot ? "Founding" : "Waitlist"}</td>
                    <td>
                      {status ? (
                        <span className="muted small">{status}</span>
                      ) : (
                        <button className="btn" disabled={busy !== null} onClick={() => sendInvite(s.email, { name: s.name || undefined, founding: s.spot, credits: s.spot ? undefined : 50 })}>
                          {busy === s.email ? "Inviting…" : s.spot ? "Invite (Founding)" : "Invite (Free)"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="account-card">
        <h2>People with accounts ({users.length})</h2>
        {users.length > 0 && (
          <table className="account-table">
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    <span className="muted small">
                      {" "}
                      · {u.founding ? "Founding · " : ""}
                      {u.plan}
                      {u.planUntil ? ` until ${date(u.planUntil)}` : ""} · joined {date(u.createdAt)}
                    </span>
                  </td>
                  <td>
                    <strong>{u.credits}</strong> <span className="muted small">credits</span>
                  </td>
                  <td className="admin-add">
                    <input
                      className="admin-num"
                      inputMode="numeric"
                      placeholder="+100"
                      value={addFor[u.id] ?? ""}
                      onChange={(e) => setAddFor((a) => ({ ...a, [u.id]: e.target.value.replace(/[^\d-]/g, "") }))}
                    />
                    <button className="btn" disabled={busy !== null || !Number(addFor[u.id])} onClick={() => addCredits(u)}>
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {invites.filter((i) => !i.joined).length > 0 && (
          <p className="muted small">
            Invited, not signed in yet: {invites.filter((i) => !i.joined).map((i) => i.email).join(", ")}
          </p>
        )}
      </section>
    </div>
  );
}
