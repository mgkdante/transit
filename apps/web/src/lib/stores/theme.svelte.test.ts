import { beforeEach, describe, expect, it, vi } from 'vitest';
import { themeStore } from './theme.svelte';

describe('theme store — canvas integration event', () => {
	beforeEach(() => {
		document.documentElement.dataset.theme = 'dark';
		localStorage.clear();
		themeStore.apply('dark', false);
	});

	it('dispatches themechange after applying the document theme', () => {
		let detail: unknown = null;
		let appliedTheme: string | undefined;
		const handler = (event: Event) => {
			detail = (event as CustomEvent).detail;
			appliedTheme = document.documentElement.dataset.theme;
		};

		document.addEventListener('themechange', handler, { once: true });
		themeStore.apply('light', false);

		expect(appliedTheme).toBe('light');
		expect(detail).toEqual({ theme: 'light' });
	});

	it('starts in SSR dark and adopts the pre-paint document theme on init', async () => {
		document.documentElement.dataset.theme = 'light';
		vi.resetModules();
		const { themeStore: freshThemeStore } = await import('./theme.svelte');

		expect(freshThemeStore.current).toBe('dark');

		freshThemeStore.init();

		expect(freshThemeStore.current).toBe('light');
		expect(document.documentElement.dataset.theme).toBe('light');
	});
});
