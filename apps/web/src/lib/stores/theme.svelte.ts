import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

function resolvedSurface(): string {
	if (!browser) return '';
	return getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
}

let surfaceFrame: number | null = null;
const surfaceMetaSelector = 'meta[name="theme-color"]:not([media])';

function updateSurfaceMeta(): void {
	if (surfaceFrame !== null || !document.querySelector(surfaceMetaSelector)) return;
	surfaceFrame = requestAnimationFrame(() => {
		surfaceFrame = null;
		document.querySelector(surfaceMetaSelector)?.setAttribute('content', resolvedSurface());
	});
}

function readDocumentTheme(): Theme {
	if (!browser) return 'dark';
	return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

let theme = $state<Theme>('dark');

function apply(next: Theme, persist: boolean): void {
	theme = next;
	if (!browser) return;
	if (document.documentElement.dataset.theme !== next) {
		document.documentElement.dataset.theme = next;
	}
	updateSurfaceMeta();
	if (persist) {
		try {
			localStorage.setItem('theme', next);
		} catch {
			// Private mode or disabled storage leaves the theme active for this session.
		}
	}
	document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
}

function toggle(): void {
	apply(theme === 'dark' ? 'light' : 'dark', true);
}

function init(): void {
	if (!browser) return;
	apply(readDocumentTheme(), false);
}

export const themeStore = {
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
