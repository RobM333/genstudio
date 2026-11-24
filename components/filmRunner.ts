// Makes a Film Set scene in the browser, one short fal job at a time, and saves
// progress on the item so a closed page carries on without paying twice.
//
// 1. Any character without a look picture gets one (front portrait + full body).
// 2. Shot 1's picture is made with the characters' look pictures.
// 3. The other shots' pictures are made at the same time, each shown shot 1's
//    picture too, so the place, light and colours match, from a new camera spot.
// 4. All shots are brought to life at the same time, starting exactly from
//    their picture, with the camera move written in.
// 5. The shots are joined, and sound is added once over the whole scene.

import { animateModelFor, KEYFRAME_MODEL_ID, REFERENCE_IMAGE_MODEL, type AspectRatio } from "@/lib/models";
import { framePrompt, motionPrompt, shotSecondsFor, STILL_MODEL_ID, choiceById, LIGHTS, type CastMember, type FilmScene, type FilmShot } from "@/lib/filmset";
import { promptName, sheetPrompt, type Character } from "@/lib/characters";
import { addSoundTo, joinShots, post, waitFor, waitForResult } from "./storyRunner";

export type FilmCast = CastMember & { sheetUrl?: string; sheetToken?: string; photo?: { url: string; token: string } };

export type FilmShotJob = FilmShot & {
  frameUrl?: string;
  frameToken?: string;
  url?: string; // the finished shot
  requestId?: string; // the running video job, so a closed page picks it up again
};

export type FilmJob = {
  still: boolean; // directing one frame (a picture), not shots
  scene: FilmScene;
  cast: FilmCast[];
  shots: FilmShotJob[];
  videoModelId: string; // text-to-video model id; shots use its "animate a picture" version
  seconds: number; // per shot, as asked (each model makes the nearest length it can)
  sound: boolean;
  aspectRatio: AspectRatio;
  joinedUrl?: string;
  step?: string;
};

/**
 * Makes a character's look picture and has the server approve it as a person
 * reference. About 4 cents.
 */
export async function makeLook(c: Pick<Character, "name" | "look" | "outfit" | "photo">): Promise<{ sheetUrl: string; sheetToken: string }> {
  const fromPhoto = Boolean(c.photo);
  const modelId = fromPhoto ? REFERENCE_IMAGE_MODEL.id : KEYFRAME_MODEL_ID;
  const job = await post("/api/generate", {
    modelId,
    prompt: sheetPrompt(c, fromPhoto),
    aspectRatio: "16:9",
    enhance: false,
    refs: fromPhoto ? [{ url: c.photo!.url, kind: "person", token: c.photo!.token, name: c.name }] : undefined,
  });
  const out = await waitForResult(job.modelId ?? modelId, job);
  const res = await fetch("/api/character", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: out.url, token: out.token, name: c.name, look: c.look, outfit: c.outfit }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error ?? "Couldn't save the character's look.");
  return { sheetUrl: out.url, sheetToken: data.token };
}

function soundPrompt(job: FilmJob): string {
  const light = choiceById(LIGHTS, job.scene.light).id;
  const where = job.scene.setting.trim() || "the scene";
  const what = job.shots.map((s) => s.action.trim()).filter(Boolean).join(". ");
  return `Natural, cinematic sound for ${where}${light === "neon" ? " at night in the city" : ""}: ${what}. Ambience and sound effects only, no speech, no singing.`.slice(0, 1400);
}

export async function buildFilm(job: FilmJob, save: (j: FilmJob) => void, onLook?: (castId: string, look: { sheetUrl: string; sheetToken: string }) => void): Promise<string> {
  const n = job.shots.length;
  const step = (s: string) => {
    job.step = s;
    save(job);
  };

  // 1. Look pictures for anyone who doesn't have one yet.
  for (const c of job.cast) {
    if (c.sheetUrl && c.sheetToken) continue;
    step(`Making ${promptName(c.name)}'s look picture`);
    const look = await makeLook(c);
    c.sheetUrl = look.sheetUrl;
    c.sheetToken = look.sheetToken;
    save(job);
    onLook?.(c.id, look);
  }
  const people = job.cast.map((c) => ({ url: c.sheetUrl!, kind: "person", token: c.sheetToken!, name: promptName(c.name) }));
  const cast: CastMember[] = job.cast.map((c) => ({ ...c, name: promptName(c.name) }));

  // 2 and 3. The pictures each shot starts from.
  const frame = async (i: number) => {
    const shot = job.shots[i];
    if (shot.frameUrl) return;
    const first = job.shots[0];
    const sameScene = i > 0 && first.frameUrl && first.frameToken;
    const modelId = people.length || sameScene ? REFERENCE_IMAGE_MODEL.id : job.still ? STILL_MODEL_ID : KEYFRAME_MODEL_ID;
    const res = await post("/api/generate", {
      modelId,
      prompt: framePrompt({ shot, scene: job.scene, cast, i, n, still: job.still }),
      aspectRatio: job.aspectRatio,
      enhance: true,
      purpose: job.still ? undefined : "keyframe",
      refs: people.length ? people : undefined,
      ...(sameScene ? { productUrl: first.frameUrl, productToken: first.frameToken, sameScene: true } : {}),
    });
    const out = await waitForResult(res.modelId ?? modelId, res);
    shot.frameUrl = out.url;
    shot.frameToken = out.token;
    save(job);
  };
  step(job.still ? "Setting up your frame" : n > 1 ? `Setting up shot 1 of ${n}` : "Setting up your shot");
  await frame(0);
  if (job.still) return job.shots[0].frameUrl!;
  if (n > 1) {
    step(`Setting up shots 2 to ${n}, same place and light`);
    await Promise.all(job.shots.map((_, i) => (i === 0 ? Promise.resolve() : frame(i))));
  }

  // 4. Bring every shot to life at the same time.
  const anim = animateModelFor(job.videoModelId);
  const secs = shotSecondsFor(job.videoModelId, job.seconds);
  const film = async (i: number) => {
    const shot = job.shots[i];
    if (shot.url) return;
    if (!shot.requestId) {
      const res = await post("/api/generate", {
        modelId: anim.id,
        prompt: motionPrompt({ shot, scene: job.scene, cast, i, n }),
        aspectRatio: job.aspectRatio,
        duration: secs,
        sound: false,
        sourceUrl: shot.frameUrl,
        enhance: true,
        purpose: "animate",
      });
      if (res.status === "COMPLETED" && res.url) {
        shot.url = res.url;
        save(job);
        return;
      }
      shot.requestId = res.requestId;
      save(job);
    }
    try {
      shot.url = await waitFor(anim.id, { requestId: shot.requestId });
    } catch (e) {
      shot.requestId = undefined; // start this shot fresh next time
      throw e;
    } finally {
      save(job);
    }
  };
  step(n > 1 ? `Filming all ${n} shots` : "Filming your shot");
  await Promise.all(job.shots.map((_, i) => film(i)));

  // 5. Join, then one soundtrack over the whole scene.
  if (!job.joinedUrl) {
    if (n > 1) step("Joining the shots");
    job.joinedUrl = await joinShots(job.shots.map((s) => s.url!));
    save(job);
  }
  if (!job.sound) return job.joinedUrl;
  step("Adding sound");
  return addSoundTo(job.joinedUrl, soundPrompt(job), n * secs, job.aspectRatio);
}

/** A copy of a finished film that makes everything again (for a new take). */
export function freshFilm(job: FilmJob): FilmJob {
  const j: FilmJob = JSON.parse(JSON.stringify(job));
  j.shots = j.shots.map((s) => ({ action: s.action, size: s.size, angle: s.angle, lens: s.lens, move: s.move }));
  j.joinedUrl = undefined;
  j.step = undefined;
  return j;
}

/** A copy that remakes only one shot (with a change), keeping the others. */
export function changeShot(job: FilmJob, i: number, note: string): FilmJob {
  const j: FilmJob = JSON.parse(JSON.stringify(job));
  const s = j.shots[i];
  if (!s) return j;
  j.shots[i] = { action: `${s.action.trim().replace(/[.\s]+$/, "")}. Change: ${note.trim()}`.slice(0, 600), size: s.size, angle: s.angle, lens: s.lens, move: s.move };
  // Shot 1 sets the place for the others; if it changes, the others still keep their own pictures.
  j.joinedUrl = undefined;
  j.step = undefined;
  return j;
}
