// The one place for the app's name and logo. Every page reads from here,
// so renaming the app or swapping the logo is a one-line change.

/** The app's name, shown everywhere a visitor can see it. */
export const BRAND_NAME = "ToastyFly";

/** Social media handle (same on every platform). */
export const BRAND_HANDLE = "@toastyflystudio";

/**
 * The full logo (toast + name) used in page headers. Files live in public/brand/.
 * - "/brand/toastyfly-logo-fun.webp"       the colourful "number 1" (toast with thumbs up), 399 x 420 (current, Rob's pick)
 * - "/brand/toastyfly-logo-flat.svg"       flat logo, white/gold, 399 x 100
 * - "/brand/toastyfly-logo-flat-light.svg" flat logo, navy/orange, for light backgrounds, 399 x 100
 * Use "" to show the name as plain text instead. Set BRAND_LOGO_SIZE to the file's shape.
 */
export const BRAND_LOGO = "/brand/toastyfly-logo-fun.webp";

/** The logo file's width and height in pixels (only the shape matters; CSS sets the shown size). */
export const BRAND_LOGO_SIZE = { width: 399, height: 420 };

/** Whether BRAND_LOGO already has the name written in it (so the name isn't shown twice). */
export const LOGO_HAS_NAME = true;

/** The small toast-only mark used in tight spots (empty screens). */
export const BRAND_MARK = "/brand/toastyfly-icon.png";

// The browser-tab icons are app/icon.png, app/favicon.ico and app/apple-icon.png (phones).

/**
 * The name of the film mode (pick camera, lens, light and look shot by shot,
 * with the same characters in every shot). Change it here and it changes everywhere.
 * Other names considered: "Director's Chair", "Shot Maker".
 */
export const FILM_NAME = "Film Set";
