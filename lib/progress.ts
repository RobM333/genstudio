// An honest, estimated progress bar. AI services don't report a real
// percentage, so we estimate from how long each model usually takes. The bar
// moves steadily, slows down near the end instead of sitting at 99%, and only
// reaches 100% when the result is actually back.

export type Phase = "queue" | "working";

export type ProgressView = {
  percent: number; // 0 to 100
  label: string;
  timeLeft: string;
};

/** Smooth curve: about 80% at the typical time, then creeps towards 95%. */
export function estimateFraction(elapsedSec: number, typicalSec: number): number {
  const t = Math.max(0, elapsedSec) / Math.max(1, typicalSec);
  return 0.95 * (1 - Math.exp(-1.75 * t));
}

function formatLeft(sec: number): string {
  if (sec <= 5) return "almost done";
  if (sec < 60) return `about ${Math.ceil(sec / 5) * 5}s left`;
  const m = Math.round(sec / 60);
  return `about ${m} min left`;
}

export function progressView(opts: {
  phase?: Phase;
  queuePosition?: number;
  elapsedSec: number;
  typicalSec: number;
  step: number; // 1-based
  steps: number;
  stepLabel: string;
}): ProgressView {
  const { phase, queuePosition, elapsedSec, typicalSec, step, steps, stepLabel } = opts;
  const prefix = steps > 1 ? `Step ${step} of ${steps}: ` : "";
  const share = 100 / steps;
  const base = (step - 1) * share;

  if (phase === "queue") {
    const pos = queuePosition && queuePosition > 0 ? ` (#${queuePosition + 1} in line)` : "";
    return { percent: base + share * 0.03, label: `${prefix}Waiting to start${pos}`, timeLeft: "starting soon" };
  }
  const frac = estimateFraction(elapsedSec, typicalSec);
  const overdue = elapsedSec > typicalSec * 1.6;
  return {
    percent: base + share * (0.05 + 0.95 * frac),
    label: `${prefix}${stepLabel}`,
    timeLeft: overdue ? "taking a bit longer than usual" : formatLeft(typicalSec - elapsedSec),
  };
}
