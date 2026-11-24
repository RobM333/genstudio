// Real example media shown on template cards, the hero and the empty gallery.
// Made with GenStudio itself; scripts/fetch-showcase.mjs puts the files in
// public/showcase/ at build time. Missing files fall back to drawn art.

export type ShowcaseMedia = { src: string; kind: "image" | "video" };

const img = (name: string): ShowcaseMedia => ({ src: `/showcase/${name}.jpg`, kind: "image" });
const REVEAL: ShowcaseMedia = { src: "/showcase/reveal.mp4", kind: "video" };

/** One example per template id. */
export const TEMPLATE_MEDIA: Record<string, ShowcaseMedia> = {
  "product-hero": img("product-hero"),
  lifestyle: img("lifestyle"),
  "story-ad": img("story-ad"),
  thumbnail: img("thumbnail"),
  "sale-banner": img("sale-banner"),
  "product-reveal": REVEAL,
  "brand-teaser": img("watch"),
  "ugc-testimonial": img("ugc"),
  // Business and social size templates, made for the made-up brand "Bloom Studio".
  "teams-background": img("teams-background"),
  "zoom-background": img("zoom-background"),
  "linkedin-banner": img("linkedin-banner"),
  "facebook-cover": img("facebook-cover"),
  "email-header": img("email-header"),
  "profile-picture": img("profile-picture"),
  "brand-announcement": img("brand-announcement"),
  "instagram-post": img("instagram-post"),
  "instagram-portrait": img("instagram-portrait"),
  "youtube-banner": img("youtube-banner"),
  "vertical-video": img("vertical-video"),
  "youtube-intro": img("youtube-intro"),
};

/** Ready-to-try prompts with the result they made, for the empty gallery. */
export const INSPIRATION: { kind: "image" | "video"; prompt: string; media: ShowcaseMedia }[] = [
  { kind: "image", prompt: "A frosted glass perfume bottle on wet black stone, soft studio light, product photo", media: img("product-hero") },
  { kind: "video", prompt: "Slow dolly shot of a sneaker rotating on a neon-lit pedestal, rain outside the window", media: REVEAL },
  { kind: "image", prompt: "Cozy coffee shop at golden hour, film photography, warm tones", media: img("lifestyle") },
  { kind: "image", prompt: "Bold flat illustration of a rocket made of sneakers, bright colors", media: img("rocket") },
];

/** Three pieces floating beside the headline. */
export const HERO_MEDIA: ShowcaseMedia[] = [img("product-hero"), REVEAL, img("story-ad")];
