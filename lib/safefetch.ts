// Fetches a public web page or picture the user pointed us at (their product
// page), refusing anything that isn't a public https address, so the server
// can't be used to reach private networks.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("64:ff9b");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function checkPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (u.protocol !== "https:") throw new Error("Please use an https:// link.");
  if (u.username || u.password || (u.port && u.port !== "443")) throw new Error("That link can't be used.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("That link can't be used.");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (ips.length === 0) throw new Error("We couldn't find that website.");
  if (ips.some(privateIp)) throw new Error("That link can't be used.");
  return u;
}

/** Fetches a public https address, following up to 3 redirects, each one checked. */
export async function safeFetch(raw: string, opts: { maxBytes: number; accept: string; timeoutMs?: number }): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string; url: string }> {
  let url = (await checkPublicUrl(raw)).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { accept: opts.accept, "user-agent": "Mozilla/5.0 (compatible; GenStudioBot/1.0)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) throw new Error("That page couldn't be opened.");
        url = (await checkPublicUrl(new URL(next, url).toString())).toString();
        continue;
      }
      if (!res.ok || !res.body) throw new Error("That page couldn't be opened.");
      const len = Number(res.headers.get("content-length") || 0);
      if (len > opts.maxBytes) throw new Error("That file is too big.");
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > opts.maxBytes) {
          await reader.cancel();
          if (opts.accept.startsWith("text/html")) break; // a long page: the top part has what we need
          throw new Error("That file is too big.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        bytes.set(c, o);
        o += c.length;
      }
      return { bytes, type: res.headers.get("content-type") ?? "", url };
    }
    throw new Error("That page redirects too many times.");
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("That page took too long to open.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
