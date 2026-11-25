import "server-only";
import { BRAND } from "./config";
import { COPYRIGHT_NOTICE } from "../appBrand";
import { whatCreditsMake } from "../pricing";
import { foundingPriceLines, longDay } from "../foundingOffer";

// Sign-in codes and invites are emailed through Resend (resend.com, free for
// up to 3,000 emails a month). Until a domain is set up there, Resend only
// delivers to the email the Resend account was made with, which is enough for
// the owner to try sign-in.

const FROM_DEFAULT = `${BRAND} <onboarding@resend.dev>`;

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "Email isn't set up." };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // Every email ends with the copyright and trademark line (plain-text version; wrap() adds it to the HTML).
      body: JSON.stringify({ from: process.env.EMAIL_FROM?.trim() || FROM_DEFAULT, to: [to], subject, text: `${text}\n\n${COPYRIGHT_NOTICE}`, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return { ok: true };
    const body = await r.text().catch(() => "");
    console.error("email failed", r.status, body.slice(0, 300));
    return { ok: false, error: r.status === 403 ? "not-verified" : "failed" };
  } catch (err) {
    console.error("email failed", err);
    return { ok: false, error: "failed" };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function wrap(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#14141a">${inner}<p style="color:#777;font-size:12px;margin-top:32px">${BRAND}. If you didn't ask for this, you can ignore this email.</p><p style="color:#999;font-size:11px;margin-top:8px">${esc(COPYRIGHT_NOTICE)}</p></div>`;
}

export function codeEmail(code: string) {
  return {
    subject: `${code} is your ${BRAND} sign-in code`,
    text: `Your ${BRAND} sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't try to sign in, you can ignore this email.`,
    html: wrap(
      `<p>Your ${BRAND} sign-in code is</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:12px 0">${esc(code)}</p><p>It works for 10 minutes.</p>`,
    ),
  };
}

export function foundingReminderEmail(opts: { name?: string; endsOn: string; link: string }) {
  const hi = opts.name ? `Hi ${opts.name},` : "Hi,";
  const lines = foundingPriceLines(opts.endsOn);
  const ask =
    "Paying isn't open yet. If you'd like to stay, just reply to this email and we'll let you know as soon as you can. Either way, thank you for being one of our first members. We'd love to hear what worked and what didn't.";
  return {
    subject: `Your ${BRAND} Founding month ends on ${longDay(opts.endsOn)}`,
    text: `${hi}\n\n${lines.join("\n\n")}\n\n${ask}\n\nYour account: ${opts.link}\n\n${BRAND}`,
    html: wrap(
      `<p>${esc(hi)}</p>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p>${esc(ask)}</p><p><a href="${esc(opts.link)}">See your account</a></p><p>${BRAND}</p>`,
    ),
  };
}

export function inviteEmail(opts: { name?: string; link: string; founding: boolean; credits: number }) {
  const hi = opts.name ? `Hi ${opts.name},` : "Hi,";
  const offer = opts.founding
    ? `Your Founding spot is ready: 1 month of the Creator plan, free, with ${opts.credits} credits. That makes ${whatCreditsMake(opts.credits).text}. It isn't unlimited: when the credits are used up they stop, and nothing is ever charged. We'll write a few days before the month ends.`
    : `Your account is ready, with ${opts.credits} credits to start with.`;
  return {
    subject: opts.founding ? `You're in: your ${BRAND} Founding spot is ready` : `You're invited to ${BRAND}`,
    text: `${hi}\n\n${offer}\n\nSign in here with this email address: ${opts.link}\nWe'll email you a 6-digit code. No password needed.\n\nThanks for being early,\n${BRAND}`,
    html: wrap(
      `<p>${esc(hi)}</p><p>${esc(offer)}</p><p><a href="${esc(opts.link)}" style="display:inline-block;background:#ff8a3d;color:#14141a;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Sign in to ${BRAND}</a></p><p>Use this email address. We'll email you a 6-digit code, no password needed.</p><p>Thanks for being early,<br>${BRAND}</p>`,
    ),
  };
}
