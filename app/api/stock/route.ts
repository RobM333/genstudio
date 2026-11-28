import { NextResponse } from "next/server";
import { checkPrompt } from "@/lib/safety";
import { isStockVideoUrl } from "@/lib/models";
import type { StockPick } from "@/lib/script";

export const dynamic = "force-dynamic";

// Script to Video: finds free stock videos for one shot, from Pixabay first
// (100 searches a minute) and then Pexels (200 an hour). Searching is free.
// Each needs its own free key, added in Netlify as PIXABAY_API_KEY and
// PEXELS_API_KEY. Without either key, stock is simply switched off.
// Both sites ask that people see where the videos come from: every pick
// carries who made it and a link to its page, shown beside the shot.

const cache = new Map<string, { at: number; picks: StockPick[] }>();
const DAY = 24 * 60 * 60 * 1000; // Pixabay asks for searches to be kept for 24 hours

function stockOn(): boolean {
  return Boolean(process.env.PIXABAY_API_KEY?.trim() || process.env.PEXELS_API_KEY?.trim());
}

export async function GET() {
  return NextResponse.json({ on: stockOn() });
}

export async function POST(req: Request) {
  let body: { q?: string; shape?: string; seconds?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!stockOn()) return NextResponse.json({ on: false, picks: [] });
  const q = String(body.q ?? "").replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!q) return NextResponse.json({ on: true, picks: [] });
  if (!checkPrompt(q).ok) return NextResponse.json({ on: true, picks: [] });
  const shape = body.shape === "9:16" ? "portrait" : body.shape === "1:1" ? "square" : "landscape";
  const seconds = Math.max(1, Math.min(30, Number(body.seconds) || 5));
  const key = `${shape}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  let picks = hit && Date.now() - hit.at < DAY ? hit.picks : null;
  if (!picks) {
    picks = [...(await pixabay(q, shape).catch(() => [])), ...(await pexels(q, shape).catch(() => []))];
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), picks });
  }
  // Long enough to cover the line, and the right way round.
  const fits = picks.filter((p) => p.seconds >= seconds && isStockVideoUrl(p.url) && shapeOk(p, shape));
  return NextResponse.json({ on: true, picks: fits.slice(0, 6) });
}

function shapeOk(p: StockPick, shape: string): boolean {
  const r = p.width / Math.max(1, p.height);
  if (shape === "portrait") return r < 0.8;
  if (shape === "square") return r > 0.8 && r < 1.25;
  return r > 1.3;
}

/** The file closest to 720p (big enough to look sharp, small enough to join quickly). */
function nearest720<T extends { width: number; height: number }>(files: T[]): T | undefined {
  const score = (f: T) => Math.abs(Math.min(f.width, f.height) - 720);
  return [...files].filter((f) => f.width > 0 && f.height > 0).sort((a, b) => score(a) - score(b))[0];
}

async function pixabay(q: string, shape: string): Promise<StockPick[]> {
  const key = process.env.PIXABAY_API_KEY?.trim();
  // Pixabay videos are almost all landscape.
  if (!key || shape !== "landscape") return [];
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&safesearch=true&per_page=20&video_type=film`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { hits?: Record<string, any>[] };
  return (data.hits ?? []).flatMap((h) => {
    const sizes = Object.values(h.videos ?? {}) as { url?: string; width?: number; height?: number; thumbnail?: string }[];
    const f = nearest720(sizes.filter((s) => s.url).map((s) => ({ url: String(s.url), width: Number(s.width), height: Number(s.height), thumb: String(s.thumbnail ?? "") })));
    if (!f) return [];
    return [{ provider: "pixabay" as const, id: String(h.id), url: f.url, thumb: f.thumb || String(h.videos?.tiny?.thumbnail ?? ""), width: f.width, height: f.height, seconds: Number(h.duration) || 0, by: String(h.user ?? "Pixabay"), page: String(h.pageURL ?? "https://pixabay.com") }];
  });
}

async function pexels(q: string, shape: string): Promise<StockPick[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return [];
  const url = `https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(q)}&orientation=${shape}&size=medium&per_page=15`;
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { videos?: Record<string, any>[] };
  return (data.videos ?? []).flatMap((v) => {
    const files = ((v.video_files ?? []) as Record<string, any>[]).filter((f) => f.file_type === "video/mp4" && f.link).map((f) => ({ url: String(f.link), width: Number(f.width), height: Number(f.height) }));
    const f = nearest720(files);
    if (!f) return [];
    return [{ provider: "pexels" as const, id: String(v.id), url: f.url, thumb: String(v.image ?? ""), width: f.width, height: f.height, seconds: Number(v.duration) || 0, by: String(v.user?.name ?? "Pexels"), page: String(v.url ?? "https://www.pexels.com") }];
  });
}
