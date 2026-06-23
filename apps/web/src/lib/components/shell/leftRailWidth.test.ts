import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// leftRailWidth — the draggable expanded width of the LEFT NAV overlay rail. The
// rail is an absolute overlay (never a paneforge pane), so its width is a single
// persisted px scalar that seeds the `--app-rail-width-expanded` CSS var. These
// helpers clamp it into a sane band and persist it (SSR-safe localStorage). The
// map canvas never reads this value, so resizing the rail can not resize the map.

const mocks = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));

async function loadModule() {
	vi.resetModules();
	return import('./leftRailWidth');
}

describe('leftRailWidth clamp', () => {
	it('keeps an in-range width unchanged', async () => {
		const { clampLeftRailWidth } = await loadModule();
		expect(clampLeftRailWidth(256)).toBe(256);
		expect(clampLeftRailWidth(300)).toBe(300);
	});

	it('raises a too-narrow width to the floor', async () => {
		const { clampLeftRailWidth, MIN_LEFT_RAIL_WIDTH } = await loadModule();
		expect(clampLeftRailWidth(40)).toBe(MIN_LEFT_RAIL_WIDTH);
	});

	it('caps a too-wide width at the ceiling so the rail never swallows the map', async () => {
		const { clampLeftRailWidth, MAX_LEFT_RAIL_WIDTH } = await loadModule();
		expect(clampLeftRailWidth(9000)).toBe(MAX_LEFT_RAIL_WIDTH);
	});

	it('rounds to an integer px', async () => {
		const { clampLeftRailWidth } = await loadModule();
		expect(clampLeftRailWidth(256.7)).toBe(257);
	});

	it('falls back to the default for non-finite input', async () => {
		const { clampLeftRailWidth, DEFAULT_LEFT_RAIL_WIDTH } = await loadModule();
		expect(clampLeftRailWidth(Number.NaN)).toBe(DEFAULT_LEFT_RAIL_WIDTH);
		expect(clampLeftRailWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_LEFT_RAIL_WIDTH);
	});
});

describe('leftRailWidth persistence', () => {
	beforeEach(() => {
		mocks.browser = true;
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	it('defaults to the 256px expanded width with no stored choice', async () => {
		const { readStoredLeftRailWidth, DEFAULT_LEFT_RAIL_WIDTH } = await loadModule();
		expect(readStoredLeftRailWidth()).toBe(DEFAULT_LEFT_RAIL_WIDTH);
		expect(DEFAULT_LEFT_RAIL_WIDTH).toBe(256);
	});

	it('persists a chosen width and reads it back across a reload', async () => {
		const { writeStoredLeftRailWidth, LEFT_RAIL_WIDTH_STORAGE_KEY } = await loadModule();

		writeStoredLeftRailWidth(300);
		expect(localStorage.getItem(LEFT_RAIL_WIDTH_STORAGE_KEY)).toBe('300');

		// A fresh module load (a page reload) seeds from the persisted value.
		const reloaded = await loadModule();
		expect(reloaded.readStoredLeftRailWidth()).toBe(300);
	});

	it('clamps a persisted width that violates the band', async () => {
		const { writeStoredLeftRailWidth, MAX_LEFT_RAIL_WIDTH, LEFT_RAIL_WIDTH_STORAGE_KEY } =
			await loadModule();
		writeStoredLeftRailWidth(9000);
		expect(localStorage.getItem(LEFT_RAIL_WIDTH_STORAGE_KEY)).toBe(String(MAX_LEFT_RAIL_WIDTH));
	});

	it('falls back to the default for a junk stored value', async () => {
		const { readStoredLeftRailWidth, LEFT_RAIL_WIDTH_STORAGE_KEY, DEFAULT_LEFT_RAIL_WIDTH } =
			await loadModule();
		localStorage.setItem(LEFT_RAIL_WIDTH_STORAGE_KEY, 'not-a-number');
		expect(readStoredLeftRailWidth()).toBe(DEFAULT_LEFT_RAIL_WIDTH);
	});

	it('on the server returns the default and does not touch storage', async () => {
		mocks.browser = false;
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		const { readStoredLeftRailWidth, writeStoredLeftRailWidth, DEFAULT_LEFT_RAIL_WIDTH } =
			await loadModule();

		expect(readStoredLeftRailWidth()).toBe(DEFAULT_LEFT_RAIL_WIDTH);
		writeStoredLeftRailWidth(300);
		expect(setItem).not.toHaveBeenCalled();
		setItem.mockRestore();
	});
});
