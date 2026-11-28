"use client";

import { startRegistration } from "@simplewebauthn/browser";

/** Adds a passkey for the signed-in person. Returns an error message, or null when it worked. */
export async function addPasskeyHere(): Promise<string | null> {
  try {
    const r = await fetch("/api/auth/passkey/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return d.error ?? "We couldn't start adding a passkey. Please try again.";
    const response = await startRegistration({ optionsJSON: d.options });
    const v = await fetch("/api/auth/passkey/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: d.challengeId, response }),
    });
    const vd = await v.json().catch(() => ({}));
    return v.ok ? null : (vd.error ?? "We couldn't add that passkey. Please try again.");
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "AbortError") return "No passkey was added. You can add one any time from your Account page.";
    if (name === "InvalidStateError") return "This device already has a passkey for your account.";
    return "We couldn't add a passkey on this device. You can still sign in with Google or your email.";
  }
}
