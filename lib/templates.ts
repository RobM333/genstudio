// Ready-made ad templates for creators and marketers.
// Each template has blanks like {product}; the user fills them in and we
// build the full prompt. Add or edit templates here.

import type { AspectRatio, MediaKind } from "./models";

export type TemplateField = { key: string; label: string; placeholder: string };

export type Template = {
  id: string;
  name: string;
  use: string; // where it's used, e.g. "Instagram story"
  kind: MediaKind;
  aspectRatio: AspectRatio;
  emoji: string;
  fields: TemplateField[];
  prompt: string; // with {key} blanks
};

const PRODUCT: TemplateField = { key: "product", label: "Product", placeholder: "a matte black water bottle" };

export const TEMPLATES: Template[] = [
  {
    id: "product-hero",
    name: "Product hero shot",
    use: "Online store, ads",
    kind: "image",
    aspectRatio: "1:1",
    emoji: "📦",
    fields: [PRODUCT, { key: "surface", label: "Standing on", placeholder: "polished white marble" }],
    prompt:
      "High-end commercial studio photo of {product} standing on {surface}, soft diffused key light, subtle reflections, clean seamless background, sharp focus, premium advertising look",
  },
  {
    id: "lifestyle",
    name: "Lifestyle scene",
    use: "Social posts",
    kind: "image",
    aspectRatio: "1:1",
    emoji: "🌿",
    fields: [PRODUCT, { key: "scene", label: "Scene", placeholder: "a sunny kitchen on a Sunday morning" }],
    prompt:
      "Natural lifestyle photo of {product} being used in {scene}, warm natural light, candid feel, shallow depth of field, shot on 35mm film",
  },
  {
    id: "story-ad",
    name: "Story ad with headline",
    use: "Instagram / TikTok story",
    kind: "image",
    aspectRatio: "9:16",
    emoji: "📱",
    fields: [PRODUCT, { key: "headline", label: "Headline", placeholder: "Stay cold for 24 hours" }],
    prompt:
      'Vertical social media ad featuring {product} in the center, bold clean headline text that says "{headline}" at the top, vibrant gradient background, modern minimal design',
  },
  {
    id: "thumbnail",
    name: "YouTube thumbnail",
    use: "YouTube",
    kind: "image",
    aspectRatio: "16:9",
    emoji: "▶️",
    fields: [
      { key: "subject", label: "Main subject", placeholder: "a surprised chef holding a giant burger" },
      { key: "title", label: "Big text", placeholder: "I TRIED IT" },
    ],
    prompt:
      'Eye-catching YouTube thumbnail, {subject} on the right, huge bold text "{title}" on the left with thick outline, high contrast, saturated colors',
  },
  {
    id: "sale-banner",
    name: "Sale banner",
    use: "Website, email",
    kind: "image",
    aspectRatio: "16:9",
    emoji: "🏷️",
    fields: [
      { key: "offer", label: "Offer", placeholder: "30% OFF EVERYTHING" },
      { key: "theme", label: "Theme", placeholder: "summer beach" },
    ],
    prompt:
      'Wide promotional banner with {theme} theme, large bold text "{offer}", clean layout with space for a button, flat modern graphic design',
  },
  {
    id: "product-reveal",
    name: "Product reveal",
    use: "TikTok / Reels",
    kind: "video",
    aspectRatio: "9:16",
    emoji: "✨",
    fields: [PRODUCT],
    prompt:
      "Vertical product reveal video: {product} slowly rotates on a pedestal while dramatic light sweeps across it, dark moody background, particles in the air, slow camera push in, premium commercial style",
  },
  {
    id: "brand-teaser",
    name: "Cinematic brand teaser",
    use: "YouTube, website hero",
    kind: "video",
    aspectRatio: "16:9",
    emoji: "🎬",
    fields: [
      { key: "brand", label: "Brand feeling", placeholder: "outdoor adventure gear" },
      { key: "place", label: "Location", placeholder: "misty mountain ridge at sunrise" },
    ],
    prompt:
      "Cinematic brand film shot for {brand}: sweeping drone shot over {place}, golden light, slow motion, anamorphic lens flare, epic and inspiring mood",
  },
  {
    id: "ugc-testimonial",
    name: "UGC-style testimonial",
    use: "TikTok / Reels ads",
    kind: "video",
    aspectRatio: "9:16",
    emoji: "🗣️",
    fields: [PRODUCT, { key: "line", label: "What they say", placeholder: "Honestly, this changed my mornings" }],
    prompt:
      'Handheld selfie-style vertical video of a friendly young person at home holding {product}, talking to the camera and saying: "{line}", natural daylight, authentic social media feel, with clear speech audio',
  },
];

export function fillTemplate(t: Template, values: Record<string, string>): string {
  return t.prompt.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key]?.trim();
    return v || t.fields.find((f) => f.key === key)?.placeholder || key;
  });
}
