// Reads the basics off a product page: name, description, price, brand and
// product pictures, from the page's sharing tags and product data.

export type ProductInfo = { name: string; description: string; price: string; brand: string; images: string[] };

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function meta(html: string, key: string): string[] {
  const out: string[] = [];
  const re = /<meta\b[^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    const k = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (k !== key) continue;
    const v = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (v) out.push(decode(v));
  }
  return out;
}

type Json = Record<string, unknown>;
function findProduct(node: unknown, depth = 0): Json | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const p = findProduct(n, depth + 1);
      if (p) return p;
    }
    return null;
  }
  const o = node as Json;
  const t = o["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return o;
  for (const k of ["@graph", "mainEntity", "itemListElement"]) {
    const p = findProduct(o[k], depth + 1);
    if (p) return p;
  }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? decode(v) : typeof v === "number" ? String(v) : "");
function images(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(images);
  if (v && typeof v === "object") return images((v as Json).url ?? (v as Json).contentUrl);
  return [];
}

export function readProductPage(html: string, pageUrl: string): ProductInfo {
  let product: Json | null = null;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      product = findProduct(JSON.parse(m[1].trim()));
    } catch {
      // some sites put broken JSON here
    }
    if (product) break;
  }
  const offers = (Array.isArray(product?.offers) ? product?.offers[0] : product?.offers) as Json | undefined;
  const brandField = product?.brand as Json | string | undefined;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const name = str(product?.name) || meta(html, "og:title")[0] || meta(html, "twitter:title")[0] || (title ? decode(title) : "");
  const description = str(product?.description) || meta(html, "og:description")[0] || meta(html, "description")[0] || "";
  const amount = str(offers?.price) || meta(html, "product:price:amount")[0] || meta(html, "og:price:amount")[0] || "";
  const currency = str(offers?.priceCurrency) || meta(html, "product:price:currency")[0] || meta(html, "og:price:currency")[0] || "";
  const brand = typeof brandField === "string" ? decode(brandField) : str(brandField?.name) || meta(html, "og:site_name")[0] || "";
  const pics = [...images(product?.image), ...meta(html, "og:image"), ...meta(html, "og:image:secure_url"), ...meta(html, "twitter:image")]
    .map((u) => {
      try {
        return new URL(u, pageUrl).toString();
      } catch {
        return "";
      }
    })
    .filter((u) => u.startsWith("https://"));
  return {
    name: name.slice(0, 120),
    description: description.slice(0, 500),
    price: amount ? `${currency === "USD" ? "$" : currency ? currency + " " : ""}${amount}`.slice(0, 30) : "",
    brand: brand.slice(0, 60),
    images: [...new Set(pics)].slice(0, 4),
  };
}

/** The ad brief's product line, written from the page. */
export function productBrief(p: ProductInfo): string {
  const parts = [p.name, p.description, p.price ? `Price: ${p.price}.` : ""].filter(Boolean);
  return parts.join(". ").replace(/\.\./g, ".").slice(0, 600);
}
