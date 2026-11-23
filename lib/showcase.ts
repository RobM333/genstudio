// Real example media shown on template cards, the hero and the empty gallery.
// Files live in public/showcase/. Anything missing falls back to drawn art.

export type ShowcaseMedia = { src: string; kind: "image" | "video"; poster?: string };

/** One example per template id. */
export const TEMPLATE_MEDIA: Record<string, ShowcaseMedia> = {};

/** Example per inspiration prompt, in the same order as the prompts. */
export const INSPO_MEDIA: (ShowcaseMedia | undefined)[] = [];

/** Up to three pieces floating beside the headline. */
export const HERO_MEDIA: ShowcaseMedia[] = [];
