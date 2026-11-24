// Ready-made templates for creators, marketers and small businesses, grouped
// by what they're for. Each template has blanks like {product}; the user fills
// them in and we build the full prompt. Add or edit templates here.

import type { AspectRatio, MediaKind } from "./models";

/** fromBrand: filled in from the saved brand kit when the template is picked. */
export type TemplateField = { key: string; label: string; placeholder: string; fromBrand?: "name" };

export type TemplateCategory = "business" | "social" | "ads";

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string; hint: string }[] = [
  { id: "ads", label: "Ads and products", hint: "Product shots, sale banners and short video ads." },
  { id: "social", label: "Social media sizes", hint: "Already the right size and shape for TikTok, Instagram and YouTube." },
  { id: "business", label: "For your business", hint: "Call backgrounds, banners and headers that use your brand kit: your name, colours and logo." },
];

/** An exact picture size in pixels. Pictures are made in the nearest shape, then the download is trimmed and resized to this. */
export type TemplateSize = { w: number; h: number };

export type Template = {
  id: string;
  name: string;
  use: string; // where it's used, e.g. "Instagram story"
  category: TemplateCategory;
  kind: MediaKind;
  aspectRatio: AspectRatio; // the shape it's made in
  size?: TemplateSize; // pictures only: the exact size the download comes out at
  tip?: string; // one line on how to use the result
  emoji: string;
  fields: TemplateField[];
  prompt: string; // with {key} blanks
};

// Each example matches the picture on that template's card.
const product = (placeholder: string): TemplateField => ({ key: "product", label: "Product", placeholder });
const business: TemplateField = { key: "name", label: "Business name", placeholder: "Bloom Studio", fromBrand: "name" };

const ALL_TEMPLATES: Template[] = [
  // ---------- For your business: these use the brand kit ----------
  {
    id: "teams-background",
    name: "Teams background",
    use: "Microsoft Teams video calls",
    category: "business",
    kind: "image",
    aspectRatio: "16:9",
    size: { w: 1920, h: 1080 },
    tip: "In Teams: during a call, open More, then Video effects, then Add new, and choose this picture.",
    emoji: "💼",
    fields: [business, { key: "place", label: "Setting", placeholder: "a bright modern office with plants and soft daylight" }],
    prompt:
      'Virtual background for video calls for a business called "{name}": {place}. Wide photo, the centre of the frame calm, softly out of focus and empty where the person on the call sits, the name "{name}" shown small and neat as a wall sign in the upper left corner, tidy and professional, natural light, no people',
  },
  {
    id: "zoom-background",
    name: "Zoom background",
    use: "Zoom video calls",
    category: "business",
    kind: "image",
    aspectRatio: "16:9",
    size: { w: 1920, h: 1080 },
    tip: "In Zoom: open Settings, then Backgrounds and effects, press +, and choose this picture.",
    emoji: "🎥",
    fields: [business, { key: "look", label: "Wall look", placeholder: "a warm wooden feature wall with a shelf and a plant" }],
    prompt:
      'Branded virtual background for Zoom calls: {look}, the business name "{name}" in large tasteful letters on the wall in the upper right, the centre kept plain and uncluttered behind where the person sits, gentle depth of field, polished and welcoming, no people',
  },
  {
    id: "linkedin-banner",
    name: "LinkedIn banner",
    use: "LinkedIn profile or company page",
    category: "business",
    kind: "image",
    aspectRatio: "16:9",
    size: { w: 1584, h: 396 },
    tip: "Your profile photo covers the lower left, so the left side is kept simple.",
    emoji: "🔗",
    fields: [business, { key: "line", label: "Short line", placeholder: "Handmade skincare from Melbourne" }],
    prompt:
      'Very wide panoramic header graphic for "{name}", all important content inside a thin horizontal band across the middle of the frame, the name "{name}" and the line "{line}" on the right side, the left third kept simple and plain, top and bottom quarters plain background, clean modern design',
  },
  {
    id: "facebook-cover",
    name: "Facebook cover",
    use: "Facebook page",
    category: "business",
    kind: "image",
    aspectRatio: "16:9",
    size: { w: 1640, h: 624 },
    tip: "Phones trim the sides a little, so the words sit in the middle.",
    emoji: "👍",
    fields: [business, { key: "scene", label: "Scene", placeholder: "fresh flowers arranged on a sunny shop counter" }],
    prompt:
      'Wide cover photo for the business "{name}": {scene}, the name "{name}" in bold clean letters in the middle, everything important inside a wide band across the centre, top and bottom kept plain, inviting and professional',
  },
  {
    id: "email-header",
    name: "Email header",
    use: "Newsletters and email signatures",
    category: "business",
    kind: "image",
    aspectRatio: "16:9",
    size: { w: 1200, h: 400 },
    emoji: "✉️",
    fields: [business, { key: "line", label: "Headline", placeholder: "Spring news from our studio" }],
    prompt:
      'Wide email newsletter header for "{name}": the name "{name}" on the left and the headline "{line}" on the right, simple decorative shapes, all content in a wide band across the middle, top and bottom plain, flat modern graphic design',
  },
  {
    id: "profile-picture",
    name: "Profile picture",
    use: "Social accounts, Google listing",
    category: "business",
    kind: "image",
    aspectRatio: "1:1",
    size: { w: 800, h: 800 },
    tip: "Most apps show it as a circle, so the design stays in the middle.",
    emoji: "🔵",
    fields: [business],
    prompt:
      'Simple bold profile picture for the business "{name}": a clean emblem with the first letter of "{name}" in the exact centre, inside a circle that fills most of the square, plain background, flat modern design, readable when very small',
  },
  {
    id: "brand-announcement",
    name: "Announcement post",
    use: "Opening hours, news, new products",
    category: "business",
    kind: "image",
    aspectRatio: "1:1",
    size: { w: 1080, h: 1080 },
    emoji: "📣",
    fields: [business, { key: "news", label: "Your news", placeholder: "Now open on Sundays" }],
    prompt:
      'Square social media announcement for the business "{name}": large bold headline "{news}", the name "{name}" small at the bottom, clean layout with generous space, flat modern graphic design',
  },

  // ---------- Social media sizes ----------
  {
    id: "instagram-post",
    name: "Instagram post",
    use: "Instagram feed, square",
    category: "social",
    kind: "image",
    aspectRatio: "1:1",
    size: { w: 1080, h: 1080 },
    emoji: "🟪",
    fields: [{ key: "subject", label: "What's in it", placeholder: "a stack of fluffy pancakes with berries on a pastel table" }],
    prompt: "Square social media photo of {subject}, bright and eye-catching, clean composition, scroll-stopping colours",
  },
  {
    id: "instagram-portrait",
    name: "Instagram portrait post",
    use: "Instagram feed, tall (takes more of the screen)",
    category: "social",
    kind: "image",
    aspectRatio: "1:1",
    size: { w: 1080, h: 1350 },
    emoji: "📷",
    fields: [{ key: "subject", label: "What's in it", placeholder: "a ceramic mug of hot chocolate by a rainy window" }],
    prompt: "Social media photo of {subject}, the subject centred with space on the left and right, bright and eye-catching, clean composition",
  },
  {
    id: "story-ad",
    name: "Story ad with headline",
    use: "Instagram / TikTok story",
    category: "social",
    kind: "image",
    aspectRatio: "9:16",
    size: { w: 1080, h: 1920 },
    tip: "Apps cover the very top and bottom with buttons, so the headline sits a little lower.",
    emoji: "📱",
    fields: [product("an oversized lilac jacket"), { key: "headline", label: "Headline", placeholder: "The new season drop" }],
    prompt:
      'Vertical social media ad featuring {product} in the center, bold clean headline text that says "{headline}" in the upper third, vibrant gradient background, modern minimal design',
  },
  {
    id: "thumbnail",
    name: "YouTube thumbnail",
    use: "YouTube",
    category: "social",
    kind: "image",
    aspectRatio: "16:9",
    size: { w: 1280, h: 720 },
    emoji: "▶️",
    fields: [
      { key: "subject", label: "Main subject", placeholder: "an excited creator holding a glowing camera" },
      { key: "title", label: "Big text", placeholder: "I TRIED IT" },
    ],
    prompt:
      'Eye-catching YouTube thumbnail, {subject} on the right, huge bold text "{title}" on the left with thick outline, high contrast, saturated colors',
  },
  {
    id: "youtube-banner",
    name: "YouTube channel banner",
    use: "Top of your YouTube channel",
    category: "social",
    kind: "image",
    aspectRatio: "16:9",
    size: { w: 2560, h: 1440 },
    tip: "Phones only show the middle strip, so the name and words stay there.",
    emoji: "📺",
    fields: [
      { key: "name", label: "Channel name", placeholder: "Bloom Studio", fromBrand: "name" },
      { key: "theme", label: "Theme", placeholder: "soft watercolour flowers on cream" },
    ],
    prompt:
      'YouTube channel banner with a {theme} background filling the whole frame, the channel name "{name}" in bold clean letters in the exact centre, all words kept inside the middle third of the height and the middle half of the width, the edges only background, modern design',
  },
  {
    id: "vertical-video",
    name: "TikTok, Reels or Shorts clip",
    use: "TikTok, Instagram Reels, YouTube Shorts",
    category: "social",
    kind: "video",
    aspectRatio: "9:16",
    emoji: "🎵",
    fields: [{ key: "subject", label: "What happens", placeholder: "a barista pours latte art in slow motion" }],
    prompt: "Vertical social media video: {subject}, close and dynamic camera, bright natural colours, the action in the centre of the frame, trendy and energetic",
  },
  {
    id: "youtube-intro",
    name: "YouTube video intro",
    use: "The first seconds of a YouTube video",
    category: "social",
    kind: "video",
    aspectRatio: "16:9",
    emoji: "🎬",
    fields: [{ key: "scene", label: "Opening scene", placeholder: "a sunrise over a quiet beach with gentle waves" }],
    prompt: "Wide cinematic opening shot for a YouTube video: {scene}, smooth slow camera move, rich colours, inviting mood",
  },

  // ---------- Ads and products ----------
  {
    id: "product-hero",
    name: "Product hero shot",
    use: "Online store, ads",
    category: "ads",
    kind: "image",
    aspectRatio: "1:1",
    emoji: "📦",
    fields: [product("a frosted glass perfume bottle"), { key: "surface", label: "Standing on", placeholder: "wet black volcanic stone" }],
    prompt:
      "High-end commercial studio photo of {product} standing on {surface}, soft diffused key light, subtle reflections, clean seamless background, sharp focus, premium advertising look",
  },
  {
    id: "lifestyle",
    name: "Lifestyle scene",
    use: "Social posts",
    category: "ads",
    kind: "image",
    aspectRatio: "1:1",
    emoji: "🌿",
    fields: [product("a latte in a ceramic cup"), { key: "scene", label: "Scene", placeholder: "a cozy coffee shop at golden hour" }],
    prompt:
      "Natural lifestyle photo of {product} being used in {scene}, warm natural light, candid feel, shallow depth of field, shot on 35mm film",
  },
  {
    id: "sale-banner",
    name: "Sale banner",
    use: "Website, email",
    category: "ads",
    kind: "image",
    aspectRatio: "16:9",
    emoji: "🏷️",
    fields: [
      { key: "offer", label: "Offer", placeholder: "30% OFF SNEAKERS" },
      { key: "theme", label: "Theme", placeholder: "pastel coral and lilac" },
    ],
    prompt:
      'Wide promotional banner with {theme} theme, large bold text "{offer}", clean layout with space for a button, flat modern graphic design',
  },
  {
    id: "product-reveal",
    name: "Product reveal",
    use: "TikTok / Reels",
    category: "ads",
    kind: "video",
    aspectRatio: "9:16",
    emoji: "✨",
    fields: [product("a white sneaker")],
    prompt:
      "Vertical product reveal video: {product} slowly rotates on a pedestal while dramatic light sweeps across it, dark moody background, particles in the air, slow camera push in, premium commercial style",
  },
  {
    id: "brand-teaser",
    name: "Cinematic brand teaser",
    use: "YouTube, website hero",
    category: "ads",
    kind: "video",
    aspectRatio: "16:9",
    emoji: "🎬",
    fields: [
      { key: "brand", label: "Brand feeling", placeholder: "a luxury watch brand" },
      { key: "place", label: "Location", placeholder: "a glittering city skyline at night" },
    ],
    prompt:
      "Cinematic brand film shot for {brand}: sweeping drone shot over {place}, golden light, slow motion, anamorphic lens flare, epic and inspiring mood",
  },
  {
    id: "ugc-testimonial",
    name: "UGC-style testimonial",
    use: "TikTok / Reels ads",
    category: "ads",
    kind: "video",
    aspectRatio: "9:16",
    emoji: "🗣️",
    fields: [product("a matte black water bottle"), { key: "line", label: "What they say", placeholder: "Honestly, it keeps my water cold all day" }],
    prompt:
      'Handheld selfie-style vertical video of a friendly young person at home holding {product}, talking to the camera and saying: "{line}", natural daylight, authentic social media feel, with clear speech audio',
  },
];

// The order people see: the most eye-catching examples first, plain banners and headers at the back.
const ORDER = ["product-hero", "product-reveal", "lifestyle", "story-ad", "brand-teaser", "thumbnail", "instagram-post", "vertical-video", "ugc-testimonial", "instagram-portrait", "youtube-intro", "youtube-banner", "sale-banner", "teams-background", "zoom-background", "brand-announcement", "profile-picture", "facebook-cover", "linkedin-banner", "email-header"];
const rank = (id: string) => (ORDER.indexOf(id) === -1 ? ORDER.length : ORDER.indexOf(id));
export const TEMPLATES: Template[] = [...ALL_TEMPLATES].sort((a, b) => rank(a.id) - rank(b.id));

/** Templates for one category, or all of them. */
export function templatesIn(category: TemplateCategory | "all", list: Template[] = TEMPLATES): Template[] {
  return category === "all" ? list : list.filter((t) => t.category === category);
}

/** The template a result was made from, found by the name saved with it. */
export function templateByName(name?: string): Template | undefined {
  return name ? TEMPLATES.find((t) => t.name === name) : undefined;
}

/** Plain words for a size, e.g. "1920 × 1080". */
export function sizeLabel(s: TemplateSize): string {
  return `${s.w} × ${s.h}`;
}

/**
 * The part of a picture to keep so it fills the wanted size without stretching:
 * trims the sides or the top and bottom equally, keeping the middle.
 */
export function coverCrop(srcW: number, srcH: number, size: TemplateSize): { sx: number; sy: number; sw: number; sh: number } {
  const want = size.w / size.h;
  if (srcW / srcH > want) {
    const sw = Math.round(srcH * want);
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH };
  }
  const sh = Math.round(srcW / want);
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh };
}

/** Starting values for a template's blanks: the business name comes from the brand kit when there is one. */
export function brandValues(t: Template, brand: { name?: string }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of t.fields) if (f.fromBrand === "name" && brand.name?.trim()) out[f.key] = brand.name.trim();
  return out;
}

export function fillTemplate(t: Template, values: Record<string, string>): string {
  return t.prompt.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key]?.trim();
    return v || t.fields.find((f) => f.key === key)?.placeholder || key;
  });
}
