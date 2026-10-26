export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';
const SURFACE_META = 'meta[name="theme-color"]:not([media])';

function readDocumentTheme(): Theme {
	if (typeof document === 'undefined') return 'dark';
	return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

let current = $state<Theme>(readDocumentTheme());
let surfaceFrame: number | null = null;

function updateSurfaceMeta(): void {
	if (surfaceFrame !== null || !document.querySelector(SURFACE_META)) return;
	surfaceFrame = requestAnimationFrame(() => {
		surfaceFrame = null;
		const surface = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
		document.querySelector(SURFACE_META)?.setAttribute('content', surface);
	});
}

function apply(next: Theme, persist: boolean): void {
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

/**
 * Dark is the default. The app's pre-paint script owns first paint from the `theme` storage key;
 * `init()` adopts what it applied. System preference is intentionally ignored.
 */
export const theme = {
	get current(): Theme {
		return current;
	},
	get isDark(): boolean {
		return current === 'dark';
	},
	set(next: Theme): void {
		apply(next, true);
	},
	toggle(): void {
		apply(current === 'dark' ? 'light' : 'dark', true);
	},
	init(): void {
		if (typeof document === 'undefined') return;
		apply(readDocumentTheme(), false);
	},
};
