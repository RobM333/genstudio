"use client";

import Link from "next/link";
import { useState } from "react";
import { LEGAL_VERSION } from "./LegalPage";

const KEY = "genstudio.terms.accepted";

/** True if this browser already accepted the current version of the terms. */
export function hasAcceptedTerms(): boolean {
  try {
    return localStorage.getItem(KEY) === LEGAL_VERSION;
  } catch {
    return false;
  }
}

function rememberAcceptance() {
  try {
    localStorage.setItem(KEY, LEGAL_VERSION);
  } catch {
    // storage blocked: they'll be asked again next visit
  }
}

export default function AgreeModal({ onAgree, onCancel }: { onAgree: () => void; onCancel: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="agree" role="dialog" aria-label="Accept terms" onClick={(e) => e.stopPropagation()}>
        <h2>Before you create</h2>
        <ul>
          <li>You must be 18 or older.</li>
          <li>You are responsible for what you create and how you use it.</li>
          <li>No sexual content of real people or anything involving minors, and no fake content that could mislead people about a real person.</li>
          <li>Only use faces, voices, logos and artwork you have permission to use.</li>
        </ul>
        <label className="agree-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            I am 18 or older and I agree to the{" "}
            <Link href="/terms" target="_blank">
              Terms of Use
            </Link>
            ,{" "}
            <Link href="/acceptable-use" target="_blank">
              Acceptable Use Policy
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <div className="agree-actions">
          <button className="pill" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="generate small"
            disabled={!checked}
            onClick={() => {
              rememberAcceptance();
              onAgree();
            }}
          >
            I agree, start creating
          </button>
        </div>
      </div>
    </div>
  );
}
