// Runs a storyboard in the browser: each shot animates from the previous
// shot's last frame, then the shots are joined and one soundtrack is added.
// Every step is a short fal job, so nothing hits the hosting time limit.

export type StoryShot = {
  prompt: string;
  url?: string; // the finished shot
  lastFrame?: string; // where the next shot starts
  status: "waiting" | "working" | "done" | "failed";
  error?: string;
};

export type Story = {
  shots: StoryShot[];
  shotModelId: string; // image-to-video model for shots that continue from a frame
  firstModelId: string; // text-to-video model for shot 1 when there is no starting picture
  shotSeconds: number;
  wantShots?: number; // planned length in shots, before planning finishes
  startUrl?: string; // starting picture (made from the user's references), if any
  refs?: { url: string; kind: string; token: string }[];
  sound: boolean;
  soundPrompt: string;
  joinedUrl?: string;
  step?: string; // plain words for the progress label
  interrupted?: boolean;
};

type Job = { status?: string; url?: string; requestId?: string; modelId?: string; error?: string; resultToken?: string };

export async function waitFor(modelId: string, job: Job): Promise<string> {
  return (await waitForResult(modelId, job)).url;
}

/** Waits for a job and also returns the server's signature for the result. */
export async function waitForResult(modelId: string, job: Job): Promise<{ url: string; token: string }> {
  if (job.status === "COMPLETED" && job.url) return { url: job.url, token: job.resultToken ?? "" };
  if (!job.requestId) throw new Error(job.error ?? "Something went wrong.");
  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`/api/status?modelId=${encodeURIComponent(modelId)}&requestId=${encodeURIComponent(job.requestId)}`);
    const data = (await res.json().catch(() => ({}))) as Job;
    if (data.status === "COMPLETED" && data.url) return { url: data.url, token: data.resultToken ?? "" };
    if (data.status === "FAILED" || !res.ok) throw new Error(data.error ?? "Something went wrong.");
  }
  throw new Error("This took too long. Please try again.");
}

export async function post(path: string, body: unknown): Promise<Job> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Job;
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export async function planStory(prompt: string, shotSeconds: number, targetSeconds?: number): Promise<string[]> {
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, shotSeconds, targetSeconds }),
  });
  const data = (await res.json().catch(() => ({}))) as { plan?: { shots: { prompt: string }[] }; error?: string };
  if (!res.ok || !data.plan) throw new Error(data.error ?? "Couldn't plan the shots.");
  return data.plan.shots.map((x) => x.prompt);
}

/** Makes the starting picture from the user's reference pictures (not shown on its own). */
export async function startPicture(story: Story, prompt: string, aspectRatio: string): Promise<string> {
  const job = await post("/api/generate", {
    modelId: "fal-ai/nano-banana/edit",
    prompt: `${prompt}\nThis is the opening frame. Show the moment just before the first action: ${story.shots[0]?.prompt ?? ""}`.slice(0, 1990),
    aspectRatio,
    enhance: true,
    purpose: "keyframe",
    refs: story.refs,
  });
  return waitFor(job.modelId ?? "fal-ai/nano-banana/edit", job);
}

export async function animateShot(story: Story, i: number, aspectRatio: string): Promise<string> {
  const start = i === 0 ? story.startUrl : story.shots[i - 1].lastFrame;
  if (i === 0 && !start) {
    // No starting picture: shot 1 is made straight from the words.
    const job = await post("/api/generate", {
      modelId: story.firstModelId,
      prompt: story.shots[0].prompt,
      aspectRatio,
      duration: story.shotSeconds,
      sound: false,
      enhance: true,
    });
    return waitFor(story.firstModelId, job);
  }
  if (!start) throw new Error("The previous shot isn't ready yet.");
  const job = await post("/api/generate", {
    modelId: story.shotModelId,
    prompt: story.shots[i].prompt,
    aspectRatio,
    duration: story.shotSeconds,
    sound: false,
    sourceUrl: start,
    enhance: true,
    purpose: "animate",
  });
  return waitFor(story.shotModelId, job);
}

export async function lastFrame(url: string): Promise<string> {
  const job = await post("/api/tool", { tool: "last-frame", urls: [url] });
  return waitFor(job.modelId ?? "fal-ai/ffmpeg-api/extract-frame", job);
}

export async function joinShots(urls: string[]): Promise<string> {
  if (urls.length === 1) return urls[0];
  const job = await post("/api/tool", { tool: "merge", urls });
  return waitFor(job.modelId ?? "fal-ai/ffmpeg-api/merge-videos", job);
}

export async function addSoundTo(url: string, prompt: string, seconds: number, aspectRatio: string): Promise<string> {
  const job = await post("/api/generate", {
    modelId: "fal-ai/mmaudio-v2",
    prompt: prompt.slice(0, 1500),
    aspectRatio,
    duration: seconds,
    sourceUrl: url,
    enhance: false,
  });
  return waitFor("fal-ai/mmaudio-v2", job);
}
