import { MediaQuery } from 'svelte/reactivity';

/** Mirrors the `breakpoint.desktop-min` token. */
export const DESKTOP_MIN_WIDTH = '1024px';

/** `desktop.current` is reactive in components and a live read elsewhere; false during SSR. */
export const desktop = new MediaQuery(`min-width: ${DESKTOP_MIN_WIDTH}`, false);
