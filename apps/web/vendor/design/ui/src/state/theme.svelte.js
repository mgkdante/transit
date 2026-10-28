import { brandMarkSvg } from '@yesid/seo-kit/icons';

const STORAGE_KEY = 'theme';
const SURFACE_META = 'meta[name="theme-color"]:not([media])';
const ICON = 'link[rel="icon"]';

/** @returns {import('./theme.svelte.js').Theme} */
function readDocumentTheme() {
	if (typeof document === 'undefined') return 'dark';
	return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

let current = $state(readDocumentTheme());
/** @type {number | null} */
let headFrame = null;

// The browser chrome takes the surface color and the tab icon takes the interactive orange.
function updateHeadColors() {
	if (headFrame !== null || !document.querySelector(`${SURFACE_META}, ${ICON}`)) return;
	headFrame = requestAnimationFrame(() => {
		headFrame = null;
		const style = getComputedStyle(document.documentElement);
		const surface = style.getPropertyValue('--background').trim();
		document.querySelector(SURFACE_META)?.setAttribute('content', surface);
		const primary = style.getPropertyValue('--primary').trim();
		if (!primary) return;
		const icon = `data:image/svg+xml,${encodeURIComponent(brandMarkSvg(primary))}`;
		for (const link of document.querySelectorAll(ICON)) link.setAttribute('href', icon);
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
	updateHeadColors();
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
