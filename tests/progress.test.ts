import { estimateFraction, progressView } from "../lib/progress";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}

check("starts at 0", estimateFraction(0, 60) === 0);
check("about 80% at the typical time", Math.abs(estimateFraction(60, 60) - 0.78) < 0.03);
check("never reaches 100% on its own", estimateFraction(10000, 60) < 0.96);
check("always moves forward", estimateFraction(30, 60) < estimateFraction(31, 60));
const q = progressView({ phase: "queue", queuePosition: 2, elapsedSec: 0, typicalSec: 60, step: 1, steps: 1, stepLabel: "Creating" });
check("queue shows place in line", q.label.includes("#3"));
const s2 = progressView({ phase: "working", elapsedSec: 0, typicalSec: 20, step: 2, steps: 2, stepLabel: "Adding sound" });
check("second step starts past halfway", s2.percent >= 50 && s2.label.startsWith("Step 2 of 2"));
const late = progressView({ phase: "working", elapsedSec: 200, typicalSec: 60, step: 1, steps: 1, stepLabel: "Creating" });
check("says when it's slower than usual", late.timeLeft.includes("longer"));

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
