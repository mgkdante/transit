import { MediaQuery } from 'svelte/reactivity';

/** Mirrors the `breakpoint.desktop-min` token. */
export const DESKTOP_MIN_WIDTH = '1024px';

/**
 * `desktop.current` is reactive in components and a live read elsewhere; false during SSR. Svelte's
 * client MediaQuery reads `window` when built, so where there is none (a node test that loads the
 * client build) it stays false and importing the state module doesn't throw.
 */
export const desktop: MediaQuery =
	typeof window === 'undefined'
		? ({ current: false } as unknown as MediaQuery)
		: new MediaQuery(`min-width: ${DESKTOP_MIN_WIDTH}`, false);
