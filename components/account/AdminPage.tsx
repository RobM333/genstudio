"use client";

// The owner's page: invite the Founding 100 from the sign-up list in groups of
// 10 to 20 (each gets 1 month of Creator with 500 credits), see how each group
// is using its credits before inviting the next, invite anyone else, and see
// everyone's credits. Only the emails in ADMIN_EMAILS can open it.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOUNDING_CREDITS_SHOWN } from "./shared";
import { FULL_LINE, TOTAL_SPOTS } from "@/lib/founding";

type Stage = { stage: "active" | "ending-soon" | "ended"; endsOn: string; daysLeft: number } | null;
type U = {
  id: string;
  email: string;
  name: string;
  credits: number;
  plan: string;
  planUntil: string | null;
  founding: boolean;
  createdAt: number;
  lastSignIn: number | null;
  used: number;
  bonus: number;
  group: number | null;
  stage: Stage;
  reminderSent: boolean;
  invitedBy: string | null;
};
type I = { email: string; name: string; credits: number; founding: boolean; at: number; joined: boolean; group: number | null };
type S = { email: string; name: string; makes: string; at: string; spot: boolean; invitedBy: string | null; reward: string | null; fullSent?: boolean };

const date = (at: number | string) =>
  new Date(typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00` : at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function stageText(u: U): string {
  if (!u.stage) return "";
  if (u.stage.stage === "ended") return `free month ended ${date(u.stage.endsOn)}, now on Free`;
  if (u.stage.stage === "ending-soon")
    return `free month ends ${date(u.stage.endsOn)} (${u.stage.daysLeft} day${u.stage.daysLeft === 1 ? "" : "s"})${u.reminderSent ? ", price message sent" : ""}`;
  return `free until ${date(u.stage.endsOn)}`;
}

export default function AdminPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [invites, setInvites] = useState<I[]>([]);
  const [signups, setSignups] = useState<S[]>([]);
  const [isFull, setIsFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; link?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [founding, setFounding] = useState(true);
  const [credits, setCredits] = useState("50");
  const [addFor, setAddFor] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);

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
    setIsFull(d.foundingFull === true);
    setLoaded(true);
  }
  useEffect(() => {
    void load();
  }, []);

  const invited = useMemo(() => new Map(invites.map((i) => [i.email, i])), [invites]);
  const joined = useMemo(() => new Set(users.map((u) => u.email)), [users]);

  async function postInvite(to: string, opts: { name?: string; founding: boolean; credits?: number; group?: number }) {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invite", email: to, ...opts }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    return { ok: Boolean(r?.ok), d };
  }

  async function sendInvite(to: string, opts: { name?: string; founding: boolean; credits?: number }) {
    setBusy(to);
    setMsg(null);
    setError(null);
    const { ok, d } = await postInvite(to, opts);
    setBusy(null);
    if (!ok) return setError(d.error ?? "The invite didn't work.");
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
  const nextGroup = Math.max(0, ...invites.map((i) => i.group ?? 0), ...users.map((u) => u.group ?? 0)) + 1;

  // How each group is getting on, so the next group can wait until it's clear.
  const groups = useMemo(() => {
    const byGroup = new Map<number, { invited: number; firstAt: number; members: U[] }>();
    for (const i of invites) {
      if (!i.group) continue;
      const g = byGroup.get(i.group) ?? { invited: 0, firstAt: i.at, members: [] };
      g.invited++;
      g.firstAt = Math.min(g.firstAt, i.at);
      byGroup.set(i.group, g);
    }
    for (const u of users) if (u.group) byGroup.get(u.group)?.members.push(u);
    return [...byGroup.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, g]) => {
        const used = g.members.reduce((t, u) => t + u.used, 0);
        const active = g.members.filter((u) => u.used > 0).length;
        const friends = users.filter((u) => u.invitedBy && g.members.some((m) => m.email === u.invitedBy)).length;
        const out = g.members.filter((u) => u.credits < 20 && u.used > 0).length;
        return { n, invited: g.invited, joined: g.members.length, active, used, avg: g.members.length ? Math.round(used / g.members.length) : 0, friends, out, at: g.firstAt };
      });
  }, [invites, users]);

  function pickNext(n: number) {
    setPicked(new Set(foundingLeft.slice(0, n).map((s) => s.email)));
  }

  async function inviteGroup() {
    const list = signups.filter((s) => picked.has(s.email));
    if (!list.length) return;
    setBusy("group");
    setMsg(null);
    setError(null);
    let emailed = 0;
    const notEmailed: string[] = [];
    let failed = 0;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      setProgress(`Inviting ${k + 1} of ${list.length}…`);
      const { ok, d } = await postInvite(s.email, { name: s.name || undefined, founding: true, group: nextGroup });
      if (!ok) failed++;
      else if (d.emailed || d.existing) emailed++;
      else notEmailed.push(s.email);
    }
    setProgress(null);
    setBusy(null);
    setPicked(new Set());
    setMsg({
      text:
        `Group ${nextGroup}: ${emailed} of ${list.length} invited.` +
        (notEmailed.length ? ` ${notEmailed.length} are on the invite list but the email couldn't be sent (Resend only sends to you until toastyfly.com is set up there): ${notEmailed.join(", ")}. They can sign in at ${window.location.origin}/signin with their email.` : "") +
        (failed ? ` ${failed} didn't work, please try those again.` : ""),
    });
    void load();
  }

  async function runReminders() {
    setBusy("reminders");
    setMsg(null);
    const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reminders" }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) return setError(d.error ?? "Couldn't send the messages.");
    setMsg({
      text:
        `Checked ${d.checked} accounts. Founding price messages sent: ${d.sent?.length ?? 0}.` +
        (d.failed?.length ? ` Couldn't email: ${d.failed.join(", ")}.` : "") +
        (d.movedToFree ? ` Moved to the Free plan: ${d.movedToFree}.` : ""),
    });
    void load();
  }

  // People on the list who won't get a Founding spot and haven't been told yet.
  const fullDue = signups.filter((s) => isFull && !invited.has(s.email) && !joined.has(s.email) && !s.fullSent);

  async function sendFullMessage() {
    setBusy("full");
    setMsg(null);
    setError(null);
    const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "full-message" }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) return setError(d.error ?? "Couldn't send the messages.");
    setMsg({
      text:
        `"Founding 100 is full" message sent to ${d.sent?.length ?? 0} ${d.sent?.length === 1 ? "person" : "people"}.` +
        (d.failed?.length ? ` Couldn't email: ${d.failed.join(", ")}.` : "") +
        (d.left ? ` ${d.left} still to go: press again in a few days for the next batch.` : ""),
    });
    void load();
  }

  const endingSoon = users.filter((u) => u.stage?.stage === "ending-soon");

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
          {invites.filter((i) => i.founding).length} of {TOTAL_SPOTS} Founding members invited, {foundingLeft.length} sign-ups not invited yet. Pick
          anyone on the list until {TOTAL_SPOTS} are invited; then the page switches to the early list. Inviting gives them 1 month of Creator with{" "}
          {FOUNDING_CREDITS_SHOWN} credits from the day they first sign in. Invite them in groups of 10 to 20, and check how the last group is using its
          credits (below) before sending the next.
        </p>
        {foundingLeft.length > 0 && (
          <div className="admin-group-bar">
            <button className="btn" disabled={busy !== null} onClick={() => pickNext(10)}>
              Pick the next 10
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => pickNext(20)}>
              Pick the next 20
            </button>
            {picked.size > 0 && (
              <>
                <button className="generate small" disabled={busy !== null} onClick={inviteGroup}>
                  {progress ?? `Invite these ${picked.size} as group ${nextGroup}`}
                </button>
                <button className="link-btn" disabled={busy !== null} onClick={() => setPicked(new Set())}>
                  Clear
                </button>
              </>
            )}
          </div>
        )}
        {loaded && signups.length === 0 && <p className="muted">No sign-ups yet.</p>}
        {signups.length > 0 && (
          <table className="account-table">
            <tbody>
              {signups.map((s, n) => {
                const inv = invited.get(s.email);
                const status = joined.has(s.email) ? `Joined${inv?.group ? ` (group ${inv.group})` : ""}` : inv ? `Invited ${date(inv.at)}${inv.group ? ` (group ${inv.group})` : ""}` : null;
                const listNote = !status && s.fullSent ? "Told it's full" : null;
                const canPick = s.spot && !status;
                return (
                  <tr key={s.email}>
                    <td className="muted">
                      {canPick ? (
                        <label className="admin-pick">
                          <input
                            type="checkbox"
                            checked={picked.has(s.email)}
                            onChange={(e) =>
                              setPicked((p) => {
                                const next = new Set(p);
                                if (e.target.checked) next.add(s.email);
                                else next.delete(s.email);
                                return next;
                              })
                            }
                            aria-label={`Pick ${s.email}`}
                          />{" "}
                          {n + 1}
                        </label>
                      ) : (
                        n + 1
                      )}
                    </td>
                    <td>
                      {s.email}
                      {s.name ? <span className="muted"> · {s.name}</span> : null}
                      {s.makes ? <span className="muted small"> · {s.makes}</span> : null}
                      {s.invitedBy ? <span className="muted small"> · invited by {s.invitedBy}</span> : null}
                    </td>
                    <td className="muted small">
                      {s.spot ? "Founding" : "Early list"}
                      {listNote ? ` · ${listNote}` : ""}
                    </td>
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
        <h2>Groups</h2>
        {groups.length === 0 ? (
          <p className="muted">No groups yet. Pick the next 10 or 20 sign-ups above and invite them together.</p>
        ) : (
          <>
            <p className="muted small">
              Credits used counts what was spent on AI work, less anything given back. A group that has used little may need a nudge; one that is running out
              tells you the {FOUNDING_CREDITS_SHOWN} credits are being used.
            </p>
            <table className="account-table">
              <tbody>
                <tr className="muted small">
                  <td>Group</td>
                  <td>Joined</td>
                  <td>Made something</td>
                  <td>Credits used</td>
                  <td>Average each</td>
                  <td>Nearly out</td>
                  <td>Friends brought</td>
                </tr>
                {groups.map((g) => (
                  <tr key={g.n}>
                    <td>
                      <strong>{g.n}</strong> <span className="muted small">invited {date(g.at)}</span>
                    </td>
                    <td>
                      {g.joined} of {g.invited}
                    </td>
                    <td>{g.active}</td>
                    <td>{g.used.toLocaleString()}</td>
                    <td>{g.avg}</td>
                    <td>{g.out}</td>
                    <td>{g.friends}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="account-card">
        <h2>Early list (after the Founding 100)</h2>
        <p className="muted small">
          People who sign up once the Founding 100 is full see this on the page and get it by email: &ldquo;{FULL_LINE}&rdquo; Use the button for
          anyone on the list who hasn&apos;t had it yet and isn&apos;t being invited. It sends up to 25 at a time, so you can send a batch every few days
          and see who replies. Nobody gets it twice.
        </p>
        <p>{fullDue.length === 0 ? "Nobody is waiting for this message." : `${fullDue.length} ${fullDue.length === 1 ? "person hasn't" : "people haven't"} had it yet.`}</p>
        <button className="btn" disabled={busy !== null || fullDue.length === 0} onClick={sendFullMessage}>
          {busy === "full" ? "Sending…" : `Send the "Founding 100 is full" message${fullDue.length > 25 ? " (next 25)" : ""}`}
        </button>
      </section>

      <section className="account-card">
        <h2>End of the free month</h2>
        <p className="muted small">
          A few days before a member&apos;s free month ends, they get a friendly email with their estimated founding price. Nobody is charged: if they don&apos;t
          stay, they move to the Free plan (50 credits a month) and keep everything they made. This runs by itself once a day on the live site.
        </p>
        <p>
          {endingSoon.length === 0
            ? "Nobody's free month ends in the next few days."
            : `Ending soon: ${endingSoon.map((u) => `${u.email} (${date(u.stage!.endsOn)}${u.reminderSent ? ", sent" : ""})`).join(", ")}`}
        </p>
        <button className="btn" disabled={busy !== null} onClick={runReminders}>
          {busy === "reminders" ? "Sending…" : "Send any messages that are due now"}
        </button>
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
                      {u.stage ? ` · ${stageText(u)}` : u.planUntil ? ` until ${date(u.planUntil)}` : ""}
                      {u.group ? ` · group ${u.group}` : ""} · joined {date(u.createdAt)}
                      {u.lastSignIn ? ` · last in ${date(u.lastSignIn)}` : ""}
                      {u.invitedBy ? ` · invited by ${u.invitedBy}` : ""}
                    </span>
                  </td>
                  <td>
                    <strong>{u.credits}</strong> <span className="muted small">left</span>
                    <br />
                    <span className="muted small">
                      {u.used} used{u.bonus ? ` · +${u.bonus} from friends` : ""}
                    </span>
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
