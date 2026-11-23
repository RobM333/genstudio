import Link from "next/link";

export const LEGAL_VERSION = "2026-11-23";

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="legal">
      <Link href="/" className="legal-back">
        ← Back to GenStudio
      </Link>
      <div className="notice warn">
        <strong>Draft.</strong> This text has not been reviewed by a lawyer yet and will change before launch.
      </div>
      <h1>{title}</h1>
      <p className="muted">Last updated: {LEGAL_VERSION}</p>
      {children}
      <p className="legal-links">
        <Link href="/terms">Terms of Use</Link> · <Link href="/acceptable-use">Acceptable Use Policy</Link> ·{" "}
        <Link href="/privacy">Privacy Policy</Link>
      </p>
    </div>
  );
}
