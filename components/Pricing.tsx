"use client";

import Link from "next/link";
import { useState } from "react";
import { creditExamples, PLANS, planPrice, YEARLY_DISCOUNT } from "@/lib/pricing";

// The proposed plans. Nothing can be bought yet: there are no accounts or
// payments, so the buttons only say so.

const PACKAGES = [
  { name: "Product ad", price: "from $299", text: "Concept, script, storyboard, several scenes and the final edit, made with you." },
  { name: "Brand campaign", price: "from $599", text: "Several ad versions and shapes, consistent with your brand, plus campaign pictures." },
  { name: "Professional production", price: "from $1,499", text: "Longer multi-scene productions with advanced editing and delivery." },
];

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const examples = creditExamples();
  return (
    <div className="pricing">
      <Link href="/" className="legal-back">
        ← Back to GenStudio
      </Link>
      <div className="notice warn">
        <strong>Not on sale yet.</strong> These are the plans we plan to offer. Accounts and payments are coming, so nothing can be bought or charged today.
      </div>
      <header className="pricing-head">
        <h1>
          Create without <em>limits</em>
        </h1>
        <p className="muted">One AI creative studio, from your first picture to finished commercials.</p>
        <div className="tabs pricing-toggle" role="tablist" aria-label="Billing">
          <button role="tab" aria-selected={!yearly} className={!yearly ? "tab active" : "tab"} onClick={() => setYearly(false)}>
            Monthly
          </button>
          <button role="tab" aria-selected={yearly} className={yearly ? "tab active" : "tab"} onClick={() => setYearly(true)}>
            Yearly <span className="tag tag-rec">Save {Math.round(YEARLY_DISCOUNT * 100)}%</span>
          </button>
        </div>
      </header>

      <div className="plans">
        {PLANS.map((p) => {
          const price = planPrice(p, yearly);
          return (
            <section key={p.id} className={p.popular ? "plan popular" : "plan"}>
              <div className="plan-name">
                <h2>{p.name}</h2>
                {p.popular && <span className="tag tag-rec">Popular</span>}
              </div>
              <p className="muted small">{p.for}</p>
              <p className="plan-price">
                <strong>${price % 1 ? price.toFixed(2) : price}</strong> <span className="muted">/ month</span>
              </p>
              <p className="muted small plan-billed">
                {p.monthly === 0 ? "Free forever" : yearly ? `$${Math.round(price * 12)} billed once a year` : "Billed monthly, cancel any time"}
              </p>
              <p className="plan-credits">{p.credits.toLocaleString("en-US")} credits a month</p>
              <ul className="plan-features">
                {p.features.map((f) => (
                  <li key={f.text} className={f.soon ? "soon" : ""}>
                    <span aria-hidden>{f.soon ? "○" : "✓"}</span> {f.text}
                    {f.soon && <span className="soon-tag">Soon</span>}
                  </li>
                ))}
              </ul>
              <button className={p.popular ? "generate small" : "btn"} disabled>
                Coming soon
              </button>
            </section>
          );
        })}
      </div>

      <section className="pricing-section">
        <h2>What credits buy</h2>
        <p className="muted small">
          Worked out from what each job costs to make today. Before anything is made, GenStudio shows how many credits it uses. AI service prices change, so these can
          change too.
        </p>
        <table className="credit-table">
          <thead>
            <tr>
              <th>What you make</th>
              <th>About</th>
            </tr>
          </thead>
          <tbody>
            {examples.map((r) => (
              <tr key={r.what}>
                <td>{r.what}</td>
                <td>
                  {r.credits} credit{r.credits > 1 ? "s" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pricing-section">
        <h2>Done for you</h2>
        <p className="muted small">Prefer we make it? Our team plans and produces it with you. Coming soon.</p>
        <div className="packages">
          {PACKAGES.map((k) => (
            <div key={k.name} className="package">
              <strong>{k.name}</strong>
              <span className="package-price">{k.price}</span>
              <p className="small muted">{k.text}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="muted small pricing-foot">
        *Commercial use follows our <Link href="/terms">Terms</Link> and the licences of the AI services we use. Credits are estimates and the final use may vary
        slightly. Plans, prices and credits are proposals and may change before launch.
      </p>
    </div>
  );
}
