const STORAGE_KEY = 'theme';
const SURFACE_META = 'meta[name="theme-color"]:not([media])';

/** @returns {import('./theme.svelte.js').Theme} */
function readDocumentTheme() {
	if (typeof document === 'undefined') return 'dark';
	return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

let current = $state(readDocumentTheme());
/** @type {number | null} */
let surfaceFrame = null;

function updateSurfaceMeta() {
	if (surfaceFrame !== null || !document.querySelector(SURFACE_META)) return;
	surfaceFrame = requestAnimationFrame(() => {
		surfaceFrame = null;
		const surface = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
		document.querySelector(SURFACE_META)?.setAttribute('content', surface);
	});
}

/**
 * @param {import('./theme.svelte.js').Theme} next
 * @param {boolean} persist
 */
function apply(next, persist) {
	current = next;
	if (typeof document === 'undefined') return;
	if (document.documentElement.dataset.theme !== next) {
		document.documentElement.dataset.theme = next;
	}
	updateSurfaceMeta();
	if (persist) {
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Storage can be unavailable in private mode; the theme still applies for this page.
		}
	}
	document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
}

export const theme = {
	get current() {
		return current;
	},
	get isDark() {
		return current === 'dark';
	},
	/** @param {import('./theme.svelte.js').Theme} next */
	set(next) {
		apply(next, true);
	},
	toggle() {
		apply(current === 'dark' ? 'light' : 'dark', true);
	},
	init() {
		if (typeof document === 'undefined') return;
		apply(readDocumentTheme(), false);
	},
};
