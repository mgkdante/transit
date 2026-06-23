import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mapDetailPanes — the draggable width of the RIGHT DETAIL panel (an absolute
// overlay anchored flush-right over the map). The panel is NOT a paneforge pane;
// its width is a single px scalar written into a CSS var and persisted, exactly
// like the left nav rail (leftRailWidth.ts). These clamp + persist that width.
// SSR-safe localStorage.

const mocks = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));

async function loadModule() {
	vi.resetModules();
	return import('./mapDetailPanes');
}

describe('mapDetailPanes clamp', () => {
	it('keeps an in-range width unchanged', async () => {
		const { clampDetailPanelWidth } = await loadModule();
		expect(clampDetailPanelWidth(360)).toBe(360);
		expect(clampDetailPanelWidth(440)).toBe(440);
	});

	it('raises a width below the floor up to the minimum', async () => {
		const { clampDetailPanelWidth, MIN_DETAIL_PANEL_WIDTH } = await loadModule();
		expect(clampDetailPanelWidth(120)).toBe(MIN_DETAIL_PANEL_WIDTH);
	});

	it('caps a width above the ceiling at the maximum', async () => {
		const { clampDetailPanelWidth, MAX_DETAIL_PANEL_WIDTH } = await loadModule();
		expect(clampDetailPanelWidth(9000)).toBe(MAX_DETAIL_PANEL_WIDTH);
	});

	it('rounds to an integer px width', async () => {
		const { clampDetailPanelWidth } = await loadModule();
		expect(Number.isInteger(clampDetailPanelWidth(360.6))).toBe(true);
		expect(clampDetailPanelWidth(360.6)).toBe(361);
	});

	it('falls back to the default for non-finite input', async () => {
		const { clampDetailPanelWidth, DEFAULT_DETAIL_PANEL_WIDTH } = await loadModule();
		expect(clampDetailPanelWidth(Number.NaN)).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
		expect(clampDetailPanelWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
	});
});

describe('mapDetailPanes persistence', () => {
	beforeEach(() => {
		mocks.browser = true;
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	it('defaults to the 360px design width with no stored choice', async () => {
		const { readStoredDetailPanelWidth, DEFAULT_DETAIL_PANEL_WIDTH } = await loadModule();
		expect(readStoredDetailPanelWidth()).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
		expect(DEFAULT_DETAIL_PANEL_WIDTH).toBe(360);
	});

	it('persists a chosen width and reads it back across a reload', async () => {
		const { writeStoredDetailPanelWidth, DETAIL_PANEL_WIDTH_STORAGE_KEY } = await loadModule();

		writeStoredDetailPanelWidth(440);
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('440');

		// A fresh module load (a page reload) seeds from the persisted value.
		const reloaded = await loadModule();
		expect(reloaded.readStoredDetailPanelWidth()).toBe(440);
	});

	it('clamps a persisted width that violates a bound', async () => {
		const { writeStoredDetailPanelWidth, MIN_DETAIL_PANEL_WIDTH, DETAIL_PANEL_WIDTH_STORAGE_KEY } =
			await loadModule();
		writeStoredDetailPanelWidth(80);
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe(
			String(MIN_DETAIL_PANEL_WIDTH),
		);
	});

	it('falls back to the default for a junk stored value', async () => {
		const {
			readStoredDetailPanelWidth,
			DETAIL_PANEL_WIDTH_STORAGE_KEY,
			DEFAULT_DETAIL_PANEL_WIDTH,
		} = await loadModule();
		localStorage.setItem(DETAIL_PANEL_WIDTH_STORAGE_KEY, 'not-a-number');
		expect(readStoredDetailPanelWidth()).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
	});

	it('on the server returns the default and does not touch storage', async () => {
		mocks.browser = false;
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		const { readStoredDetailPanelWidth, writeStoredDetailPanelWidth, DEFAULT_DETAIL_PANEL_WIDTH } =
			await loadModule();

		expect(readStoredDetailPanelWidth()).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
		writeStoredDetailPanelWidth(440);
		expect(setItem).not.toHaveBeenCalled();
		setItem.mockRestore();
	});
});
