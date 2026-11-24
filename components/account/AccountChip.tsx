"use client";

// The credit balance and account menu at the top of the studio. Shows nothing
// when accounts are off.

import Link from "next/link";
import { PLAN_NAMES, useAccount } from "./Account";

export default function AccountChip() {
  const a = useAccount();
  if (!a) return null;
  const { me } = a;
  const low = me.credits < 20;
  return (
    <div className="account-chip">
      <Link href="/account" className={low ? "credit-pill low" : "credit-pill"} title="Your credits and account">
        <span className="credit-dot" aria-hidden />
        <strong>{me.credits.toLocaleString()}</strong> credits
      </Link>
      <div className="account-line">
        <Link href="/account" className="account-email" title={me.email}>
          {me.email}
        </Link>
        <span className="account-plan">
          {me.founding ? "Founding · " : ""}
          {PLAN_NAMES[me.plan]}
        </span>
      </div>
      {me.admin && (
        <Link href="/admin" className="account-admin">
          Owner page
        </Link>
      )}
    </div>
  );
}
