// Moabom's own drawings, not from an icon set (icons.ts is Lucide). The moon is the one picture the app owns:
// it closes the day wherever the day is over — the moon screen, the collection hero, episode badges, the
// up-next card, the home card and the settings preview — always the same warm gold crescent, so a child
// learns one sign for "that's all for today". No face: the design avoids drawn mascots.

/** The sun on the home sky: filled like the moon, with short rays. It leaves when the moon comes. */
export function sun(size: number): string {
  return `<svg class="art-sun" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <g stroke="#f6d365" stroke-width="3.4" stroke-linecap="round"><path d="M24 3v5M24 40v5M3 24h5M40 24h5M9.2 9.2l3.5 3.5M35.3 35.3l3.5 3.5M9.2 38.8l3.5-3.5M35.3 12.7l3.5-3.5"/></g>
    <circle cx="24" cy="24" r="12" fill="#f6d365"/>
  </svg>`;
}

/** The crescent: a disc (centre 23,26, r 17) with a bite (centre 31,17.5, r 14) taken out of its upper right. */
const CRESCENT = 'M19.63 9.34A17 17 0 1 0 39.84 28.36A14 14 0 0 1 19.63 9.34Z';
/** A four-point star resting in the bite. */
const STAR = 'M35 9.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z';

/**
 * The moon, drawn like the picture-book pages: filled, with a darker "ledge" under it (the same idea as the
 * panels' 0 6px 0 shadow). Decorative; callers give the surrounding control its accessible name.
 */
export function moon(size: number): string {
  return `<svg class="art-moon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path d="${CRESCENT}" transform="translate(0 2.5)" fill="#c98f26"/>
    <path d="${CRESCENT}" fill="#f6d365"/>
    <path d="${STAR}" fill="#f6d365"/>
  </svg>`;
}
