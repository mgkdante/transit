/**
 * No-flash theme store (Svelte 5 runes). The synchronous pre-paint script in
 * app.html owns the FIRST paint (reads localStorage, sets
 * <html data-theme>); this store owns everything after hydration: toggle
 * writes, the <meta name="theme-color"> surface colour, localStorage
 * persistence, the themechange event consumed by canvas layers, and a re-sync
 * on mount.
 *
 * Dark is the brand default: no-JS, crawlers, and an absent stored choice all
 * resolve to dark (matching the markup default in app.html).
 *
 * SSR-safe: every document/localStorage touch is browser-guarded.
 */
import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

/**
 * Address-bar / PWA surface colour for the currently-applied theme. Read live
 * from the resolved `--background` token on <html> so it can never drift from
 * the design system (no hand-copied hex). Must be called AFTER `data-theme`
 * is set, so getComputedStyle reflects the target theme's background.
 */
function resolvedSurface(): string {
	if (!browser) return '';
	return getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
}

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
	// Target the NON-media theme-color meta (SeoHead's, in %sveltekit.head%). The
	// two media-scoped metas in app.html own the no-JS first paint; once the user
	// makes an explicit choice we drive the unscoped tag, which wins regardless of
	// the OS prefers-color-scheme.
	document
		.querySelector('meta[name="theme-color"]:not([media])')
		?.setAttribute('content', resolvedSurface());
	if (persist) {
		try {
			localStorage.setItem('theme', next);
		} catch {
			/* private mode / disabled storage — session-only theming is fine */
		}
	}
	document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
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
