// The public landing page: a wall of real results people scroll through,
// then templates, then the Create page. Name and logo come from lib/founding.ts.

/**
 * Is the studio open to the public yet? While it's false, "Make one like this",
 * template cards and "Start creating" lead to the founding sign-up instead of
 * the password-protected studio. Flip it to true when accounts launch.
 */
export const STUDIO_OPEN = false;

/** Where the studio (the Create page and everything after it) lives. */
export const STUDIO_PATH = "/studio";

export type WallGroup = "video" | "product" | "social" | "business";

export type WallItem = {
  /** A file in public/showcase (made with the app itself, see scripts/fetch-showcase.mjs). */
  src: string;
  kind: "image" | "video";
  group: WallGroup;
  /** Short name of what it is, e.g. "Product photo". */
  label: string;
  /** What the picture or video shows, in plain words. */
  what: string;
  /** The template it was made with, if any, so "Make one like this" can open it. */
  template?: string;
};

const pic = (name: string, group: WallGroup, label: string, what: string, template?: string): WallItem => ({
  src: `/showcase/${name}.jpg`,
  kind: "image",
  group,
  label,
  what,
  template,
});

/**
 * Every example on the wall, most eye-catching first. Only real results made
 * with the app: no stock photos, no real people, teams or brand logos.
 * Add new ones here (and their file in scripts/fetch-showcase.mjs).
 */
export const WALL: WallItem[] = [
  { src: "/showcase/reveal.mp4", kind: "video", group: "video", label: "Video", what: "A sneaker turning on a neon-lit stand while rain runs down the window", template: "product-reveal" },
  pic("product-hero", "product", "Product photo", "A frosted glass perfume bottle on wet black stone", "product-hero"),
  pic("story-ad", "social", "Story ad", "An oversized lilac jacket with the headline “The new season drop”", "story-ad"),
  pic("watch", "product", "Brand film still", "A sweeping shot over a city skyline at night for a luxury watch brand", "brand-teaser"),
  pic("rocket", "social", "Illustration", "A rocket made of sneakers, in bold flat colours"),
  pic("lifestyle", "product", "Lifestyle photo", "A latte in a ceramic cup in a coffee shop at golden hour", "lifestyle"),
  pic("thumbnail", "social", "YouTube thumbnail", "A creator holding a glowing camera, with big “I TRIED IT” text", "thumbnail"),
  pic("instagram-post", "social", "Instagram post", "A stack of fluffy pancakes with berries on a pastel table", "instagram-post"),
  pic("vertical-video", "social", "TikTok still", "A barista pouring latte art, framed for a vertical clip", "vertical-video"),
  pic("youtube-intro", "social", "Video intro still", "A sunrise over a quiet beach with gentle waves", "youtube-intro"),
  pic("ugc", "product", "Social ad still", "A matte black water bottle in a selfie-style ad", "ugc-testimonial"),
  pic("instagram-portrait", "social", "Instagram portrait", "A ceramic mug of hot chocolate by a rainy window", "instagram-portrait"),
  pic("sale-banner", "product", "Sale banner", "“30% OFF SNEAKERS” in pastel coral and lilac", "sale-banner"),
  pic("teams-background", "business", "Teams background", "A bright office with plants for a made-up shop called Bloom Studio", "teams-background"),
  pic("youtube-banner", "social", "YouTube banner", "Soft watercolour flowers on cream with the channel name", "youtube-banner"),
  pic("zoom-background", "business", "Zoom background", "A warm wooden wall with the business name and a plant", "zoom-background"),
  pic("brand-announcement", "business", "Announcement post", "“Now open on Sundays” for a small business", "brand-announcement"),
  pic("facebook-cover", "business", "Facebook cover", "Fresh flowers on a sunny shop counter with the shop's name", "facebook-cover"),
  pic("profile-picture", "business", "Profile picture", "A clean round emblem with the business's first letter", "profile-picture"),
  pic("linkedin-banner", "business", "LinkedIn banner", "A calm header with the business name and a short line", "linkedin-banner"),
  pic("email-header", "business", "Email header", "“Spring news from our studio” newsletter header", "email-header"),
];

export const WALL_FILTERS: { id: WallGroup | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "video", label: "Video" },
  { id: "product", label: "Products and ads" },
  { id: "social", label: "Social posts" },
  { id: "business", label: "For your business" },
];

/** The examples in one group, keeping the wall's order. */
export function wallIn(group: WallGroup | "all", list: WallItem[] = WALL): WallItem[] {
  return group === "all" ? list : list.filter((w) => w.group === group);
}

/**
 * Deals the examples into columns for the moving wall at the top, round-robin
 * so each column gets a mix, and starts each column at a different place so
 * neighbours don't line up.
 */
export function dealColumns<T>(list: T[], columns: number): T[][] {
  const cols: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  list.forEach((item, i) => cols[i % cols.length].push(item));
  return cols.map((col, c) => {
    if (col.length < 2) return col;
    const shift = c % col.length;
    return [...col.slice(shift), ...col.slice(0, shift)];
  });
}

/** Where "Make one like this" goes: the studio with the template open, or the founding sign-up while the studio is closed. */
export function makeLink(item: { template?: string }, open = STUDIO_OPEN): string {
  if (!open) return "/founding#claim";
  return item.template ? `${STUDIO_PATH}?template=${encodeURIComponent(item.template)}` : `${STUDIO_PATH}?view=create`;
}

/** Where a template card goes. */
export function templateLink(id: string, open = STUDIO_OPEN): string {
  return open ? `${STUDIO_PATH}?template=${encodeURIComponent(id)}` : "/founding#claim";
}
