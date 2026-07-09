import { beforeEach, describe, expect, it } from 'vitest';
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
});
