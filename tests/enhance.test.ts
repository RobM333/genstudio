import { enhanceWithRules } from "../lib/enhance";
import { getModel } from "../lib/models";
import { checkPrompt } from "../lib/safety";
import { pickModel } from "../lib/router";
import { parseReply } from "../lib/enhance";
import { parseAnalysis } from "../lib/analyze";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}

const flux = getModel("fal-ai/flux/schnell")!;
const veo = getModel("fal-ai/veo3/fast")!;
const kling = getModel("fal-ai/kling-video/v2.5-turbo/pro/text-to-video")!;

const a = enhanceWithRules("a red sneaker on a table", flux);
check("image keeps the user's words", a.startsWith("a red sneaker on a table"));
check("image adds lighting", a.includes("lighting"));
check("video with two people in a car gets separate exits", enhanceWithRules("two friends get out of a car", kling).includes("their own door"));
check("illustration skips camera words", !enhanceWithRules("flat illustration of a fox", flux).includes("camera"));
check("video adds camera movement", enhanceWithRules("a dog runs on the beach", kling).includes("camera movement"));
check("veo with sound adds ambient sound", enhanceWithRules("rain on a window", veo, true).includes("sound"));
check("veo without sound adds no sound", !enhanceWithRules("rain on a window", veo, false).includes("sound"));
check("enhanced text still passes safety", checkPrompt(a).ok);

const textDraft = pickModel({ kind: "image", prompt: 'thumbnail with huge bold text "I TRIED IT"', quality: "draft", aspectRatio: "16:9" });
check("text drafts avoid FLUX Schnell", textDraft.model.id !== "fal-ai/flux/schnell");
const plainDraft = pickModel({ kind: "image", prompt: "a red sneaker on a table", quality: "draft", aspectRatio: "1:1" });
check("plain drafts stay on FLUX Schnell", plainDraft.model.id === "fal-ai/flux/schnell");

const busy = pickModel({ kind: "video", prompt: "A man sits in a stadium watching a player dunk while a boy and his parents watch in awe", quality: "final", aspectRatio: "16:9" });
check("busy scenes use the strongest video model", busy.model.id === "fal-ai/veo3/fast");
const j = parseReply('```json\n{"prompt": "Wide shot from courtside.", "note": "We focused on the dunk."}\n```');
check("reads the booster's JSON reply", j.prompt === "Wide shot from courtside." && j.note === "We focused on the dunk.");
check("plain text replies still work", parseReply("A red shoe on a table.").prompt === "A red shoe on a table.");
const an = parseAnalysis('Sure: {"problems": ["Hoop on the wrong side"], "fix": "Move the hoop right", "prompt": "Better prompt"}');
check("reads an analysis", an?.problems.length === 1 && an?.fix === "Move the hoop right");
check("rejects junk analysis", parseAnalysis("no idea") === null);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
