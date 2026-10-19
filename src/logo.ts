// The moabom mark (design P1-9, eng D8): a play button sprouting from two leaves, 모아(cupped) + 봄(spring, to watch).
// Drawn by us, not an icon set. The same paths make public/logo.svg, the app icons and public/og.png
// (scripts/brand.html renders them).

export const LOGO_PATHS =
  '<path d="M30.5 58C15.5 58 6 47 6 32c14 0 24.5 8.5 24.5 26z"/>' +
  '<path d="M33.5 58C48.5 58 58 47 58 32c-14 0-24.5 8.5-24.5 26z"/>' +
  '<path d="M25 6.6v23.8a2.6 2.6 0 0 0 4 2.2l18.6-11.9a2.6 2.6 0 0 0 0-4.4L29 4.4a2.6 2.6 0 0 0-4 2.2z"/>';

/** Brand green: app icon, og.png and the favicon only; screens draw the mark in --ink (design DR21). */
export const BRAND_COLOR = '#2E9E6B';

/** Decorative mark in the current text colour; the heading next to it carries the name. */
export function logo(size: number): string {
  return `<svg class="logo" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" focusable="false">${LOGO_PATHS}</svg>`;
}
