import { NextResponse } from "next/server";

// TEMPORARY (preview only, never merged): times each Netlify Blobs step.
export const dynamic = "force-dynamic";

async function timed<T>(label: string, out: Record<string, unknown>, fn: () => Promise<T>, ms = 6000): Promise<T | undefined> {
  const t0 = Date.now();
  try {
    const v = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    out[label] = { ms: Date.now() - t0, ok: true, v: v === undefined ? "undefined" : JSON.stringify(v)?.slice(0, 80) };
    return v;
  } catch (e) {
    out[label] = { ms: Date.now() - t0, ok: false, err: String(e).slice(0, 200) };
    return undefined;
  }
}

export async function GET(req: Request) {
  const out: Record<string, unknown> = {};
  const consistency = new URL(req.url).searchParams.get("c") === "eventual" ? "eventual" : "strong";
  out.consistency = consistency;
  const mod = await timed("import", out, () => import("@netlify/blobs"));
  if (!mod) return NextResponse.json(out);
  const store = mod.getStore({ name: "accounts", consistency });
  await timed("list", out, () => store.list({ prefix: "debug/" }).then((r) => r.blobs.length));
  await timed("getMissing", out, () => store.get("debug/missing", { type: "json" }));
  await timed("setJSON", out, () => store.setJSON("debug/probe", { at: Date.now() }));
  await timed("get", out, () => store.get("debug/probe", { type: "json" }));
  await timed("getWithMetadata", out, () => store.getWithMetadata("debug/probe", { type: "json" }).then((r) => r?.etag));
  await timed("delete", out, () => store.delete("debug/probe"));
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}` }, signal: AbortSignal.timeout(6000) });
    out.resend = { ms: Date.now() - t0, status: r.status };
  } catch (e) {
    out.resend = { ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
  return NextResponse.json(out);
}
