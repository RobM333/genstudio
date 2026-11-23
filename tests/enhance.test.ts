import { enhanceWithRules } from "../lib/enhance";
import { getModel } from "../lib/models";
import { checkPrompt } from "../lib/safety";

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
check("illustration skips camera words", !enhanceWithRules("flat illustration of a fox", flux).includes("camera"));
check("video adds camera movement", enhanceWithRules("a dog runs on the beach", kling).includes("camera movement"));
check("veo with sound adds ambient sound", enhanceWithRules("rain on a window", veo, true).includes("sound"));
check("veo without sound adds no sound", !enhanceWithRules("rain on a window", veo, false).includes("sound"));
check("enhanced text still passes safety", checkPrompt(a).ok);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
