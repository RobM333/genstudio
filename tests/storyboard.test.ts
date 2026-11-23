import { lengthAdvice, parsePlan, planWithRules } from "../lib/storyboard";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}

const idea =
  "A woman walks into a sunny kitchen. Then she pours coffee into a white mug. Finally she sits by the window and smiles.";
const r = planWithRules(idea, 5);
check("rules split a 3-moment idea into 3 shots", r.shots.length === 3);
check("needs 15 seconds", r.neededSeconds === 15);
check("advice mentions linked shots", (lengthAdvice(r, 5) ?? "").includes("3 linked shots"));
check("advice warns a 5s clip is too short", (lengthAdvice(r, 5) ?? "").includes("only show one"));
check("one simple moment needs no advice", lengthAdvice(planWithRules("A red sneaker slowly rotating on a pedestal", 5), 5) === null);

const t = planWithRules(idea, 5, 30);
check("a 30s target makes 6 shots", t.shots.length === 6 && t.neededSeconds === 30);
const t2 = planWithRules(idea, 5, 10);
check("a 10s target merges into 2 shots", t2.shots.length === 2);

const p = parsePlan('```json\n{"moments": 2, "shots": [{"prompt": "She walks in."}, {"prompt": "She sits."}], "note": "Two shots."}\n```', 6);
check("reads the planner reply", p !== null && p.shots.length === 2 && p.neededSeconds === 12 && p.note === "Two shots.");
check("rejects junk", parsePlan("no idea") === null && parsePlan('{"shots": []}') === null);
const big = parsePlan(JSON.stringify({ shots: Array.from({ length: 12 }, (_, i) => ({ prompt: `shot ${i}` })) }), 5);
check("caps at 30 seconds", big !== null && big.neededSeconds === 30);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
