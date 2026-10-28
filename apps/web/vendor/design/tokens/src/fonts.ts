/** Fonts worth preloading: the latin faces every page renders first. Latin-ext loads on demand. */
const PRELOADED = /(?:^|\/)(?:inter|jetbrains-mono)-latin-wght-normal(?:[.-][\w-]+)?\.woff2$/;

/**
 * True for the bundled font files that belong in a preload hint. Use it in SvelteKit's
 * `resolve(event, { preload: ({ type, path }) => type !== 'font' || preloadFont(path) })`.
 */
export function preloadFont(path: string): boolean {
  return PRELOADED.test(path);
}
