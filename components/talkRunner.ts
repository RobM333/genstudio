// Makes a talking video in the browser, one short fal job at a time: first the
// words are read in the user's copied voice, then their photo says them.
// Progress is saved on the item, so a closed page carries on where it stopped.

import { TALK_SPEECH_MODEL_ID, TALK_VIDEO_MODEL_ID } from "@/lib/talk";
import { post, waitFor, waitForResult } from "./storyRunner";

export type TalkJob = {
  text: string;
  language: string;
  seconds: number; // estimated from the words
  voiceId: string;
  voiceToken: string;
  photoUrl: string;
  photoToken: string;
  audioUrl?: string; // the words in their voice
  audioToken?: string;
  videoRequestId?: string; // the video job, so a closed page picks it up again instead of paying twice
  step?: string;
};

export async function buildTalk(job: TalkJob, save: (j: TalkJob) => void): Promise<string> {
  if (!job.audioUrl) {
    job.step = "Reading your words in your voice";
    save(job);
    const res = await post("/api/talk", { action: "speak", text: job.text, voiceId: job.voiceId, voiceToken: job.voiceToken, language: job.language });
    const out = await waitForResult(res.modelId ?? TALK_SPEECH_MODEL_ID, res);
    job.audioUrl = out.url;
    job.audioToken = out.token;
    save(job);
  }
  job.step = "Making your video, lips matched to your voice";
  save(job);
  if (job.videoRequestId) return waitFor(TALK_VIDEO_MODEL_ID, { requestId: job.videoRequestId });
  const res = await post("/api/talk", {
    action: "video",
    imageUrl: job.photoUrl,
    imageToken: job.photoToken,
    audioUrl: job.audioUrl,
    audioToken: job.audioToken,
    text: job.text,
  });
  if (res.requestId) {
    job.videoRequestId = res.requestId;
    save(job);
  }
  return waitFor(res.modelId ?? TALK_VIDEO_MODEL_ID, res);
}
