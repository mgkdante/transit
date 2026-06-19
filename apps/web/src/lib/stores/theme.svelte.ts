/**
 * No-flash theme store (Svelte 5 runes). The synchronous pre-paint script in
 * app.html owns the FIRST paint (reads localStorage, sets
 * <html data-theme>); this store owns everything after hydration: toggle
 * writes, the <meta name="theme-color"> surface colour, localStorage
 * persistence, and a re-sync on mount.
 *
 * Dark is the brand default: no-JS, crawlers, and an absent stored choice all
 * resolve to dark (matching the markup default in app.html).
 *
 * SSR-safe: every document/localStorage touch is browser-guarded.
 */
import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

/**
 * Address-bar / PWA surface colour per theme. These mirror the resolved
 * --background token for each theme:
 *   dark  -> #141414 (near-black board)
 *   light -> #F3F6FB (cool-slate paper)
 */
const THEME_SURFACE: Record<Theme, string> = {
	dark: '#141414',
	light: '#F3F6FB',
};

/** Read the theme the pre-paint script applied to <html data-theme>. */
function readDocumentTheme(): Theme {
	if (!browser) return 'dark';
	return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

let theme = $state<Theme>(readDocumentTheme());

/**
 * Apply a theme everywhere it lives: the runes state, the <html data-theme>
 * attribute, the theme-color meta, and (when persist) localStorage.
 */
function apply(next: Theme, persist: boolean): void {
	theme = next;
	if (!browser) return;
	document.documentElement.dataset.theme = next;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_SURFACE[next]);
	if (persist) {
		try {
			localStorage.setItem('theme', next);
		} catch {
			/* private mode / disabled storage — session-only theming is fine */
		}
	}
}

/** Flip between dark and light, persisting the explicit choice. */
function toggle(): void {
	apply(theme === 'dark' ? 'light' : 'dark', true);
}

/**
 * Call once from the root layout onMount. Re-syncs the store with whatever the
 * inline pre-paint script applied (and back-fills the theme-color meta, which
 * is SSR'd dark). Does not persist — re-sync is not a user choice.
 */
function init(): void {
	if (!browser) return;
	apply(readDocumentTheme(), false);
}

export const themeStore = {
	/** Reactive current theme ('dark' | 'light'). */
	get current(): Theme {
		return theme;
	},
	get isDark(): boolean {
		return theme === 'dark';
	},
	apply,
	toggle,
	init,
};
