import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeStore } from './theme.svelte';

const frames: FrameRequestCallback[] = [];
const metas: HTMLMetaElement[] = [];

function addMeta(content: string, media?: string): HTMLMetaElement {
	const meta = document.createElement('meta');
	meta.name = 'theme-color';
	meta.content = content;
	if (media) meta.setAttribute('media', media);
	document.head.append(meta);
	metas.push(meta);
	return meta;
}

describe('theme store', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
		);
		document.documentElement.dataset.theme = 'dark';
		localStorage.clear();
		themeStore.apply('dark', false);
	});

	afterEach(() => {
		for (const meta of metas.splice(0)) meta.remove();
		for (const callback of frames.splice(0)) callback(0);
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
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

	it('adopts the pre-paint theme without rewriting it or resolving CSS during hydration', async () => {
		document.documentElement.dataset.theme = 'light';
		const meta = addMeta('SSR dark');
		const declaration = document.createElement('div').style;
		declaration.setProperty('--background', ' resolved light ');
		const style = vi.fn().mockReturnValue(declaration);
		vi.stubGlobal('getComputedStyle', style);
		vi.resetModules();
		const { themeStore: freshThemeStore } = await import('./theme.svelte');
		const observer = new MutationObserver(() => {});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});
		try {
			freshThemeStore.init();
			expect(freshThemeStore.current).toBe('light');
			expect(observer.takeRecords()).toHaveLength(0);
			expect(style).not.toHaveBeenCalled();
			expect(meta.content).toBe('SSR dark');
			expect(frames).toHaveLength(1);
			frames.shift()!(0);
			expect(style).toHaveBeenCalledWith(document.documentElement);
			expect(meta.content).toBe('resolved light');
		} finally {
			observer.disconnect();
		}
	});

	it('coalesces rapid changes while preserving immediate canvas events and the latest head metadata', () => {
		const previousMeta = addMeta('previous page');
		const mediaMeta = addMeta('OS fallback', '(prefers-color-scheme: dark)');
		const style = vi.fn(() => {
			const declaration = document.createElement('div').style;
			declaration.setProperty('--background', `resolved ${document.documentElement.dataset.theme}`);
			return declaration;
		});
		vi.stubGlobal('getComputedStyle', style);
		const events: unknown[] = [];
		const handler = (event: Event) => events.push((event as CustomEvent).detail);
		document.addEventListener('themechange', handler);
		try {
			themeStore.apply('light', true);
			themeStore.apply('dark', true);
			expect(events).toEqual([{ theme: 'light' }, { theme: 'dark' }]);
			expect(document.documentElement.dataset.theme).toBe('dark');
			expect(localStorage.getItem('theme')).toBe('dark');
			expect(style).not.toHaveBeenCalled();
			expect(frames).toHaveLength(1);
			previousMeta.remove();
			const currentMeta = addMeta('new page');
			frames.shift()!(0);
			expect(style).toHaveBeenCalledOnce();
			expect(currentMeta.content).toBe('resolved dark');
			expect(previousMeta.content).toBe('previous page');
			expect(mediaMeta.content).toBe('OS fallback');
		} finally {
			document.removeEventListener('themechange', handler);
		}
	});
});
