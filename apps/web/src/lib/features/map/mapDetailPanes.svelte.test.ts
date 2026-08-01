import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mapDetailPanes — the draggable width of the RIGHT DETAIL panel (an absolute
// overlay anchored flush-right over the map). The panel is NOT a paneforge pane;
// its width is a single px scalar written into a CSS var. These helpers clamp
// and persist that width with SSR-safe localStorage access.

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
		expect(MIN_DETAIL_PANEL_WIDTH).toBe(300);
		expect(clampDetailPanelWidth(120)).toBe(MIN_DETAIL_PANEL_WIDTH);
	});

	it('caps a width above the ceiling at the maximum', async () => {
		const { clampDetailPanelWidth, MAX_DETAIL_PANEL_WIDTH } = await loadModule();
		expect(MAX_DETAIL_PANEL_WIDTH).toBe(560);
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
		vi.restoreAllMocks();
	});

	it('defaults to the 360px design width with no stored choice', async () => {
		const { readStoredDetailPanelWidth, DEFAULT_DETAIL_PANEL_WIDTH } = await loadModule();
		expect(readStoredDetailPanelWidth()).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
		expect(DEFAULT_DETAIL_PANEL_WIDTH).toBe(360);
	});

	it('persists a chosen width and reads it back across a reload', async () => {
		const { writeStoredDetailPanelWidth, DETAIL_PANEL_WIDTH_STORAGE_KEY } = await loadModule();
		expect(DETAIL_PANEL_WIDTH_STORAGE_KEY).toBe('transit:detail-panel-width');

		writeStoredDetailPanelWidth(440);
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('440');

		// A fresh module load (a page reload) seeds from the persisted value.
		const reloaded = await loadModule();
		expect(reloaded.readStoredDetailPanelWidth()).toBe(440);
	});

	it.each([
		['80', 300],
		['9000', 560],
	] as const)('clamps stored %s to %s on read', async (stored, expected) => {
		const { readStoredDetailPanelWidth } = await loadModule();
		localStorage.setItem('transit:detail-panel-width', stored);

		expect(readStoredDetailPanelWidth()).toBe(expected);
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

	it('falls back to the default when storage getItem throws', async () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('storage blocked');
		});
		const { readStoredDetailPanelWidth, DEFAULT_DETAIL_PANEL_WIDTH } = await loadModule();

		expect(readStoredDetailPanelWidth()).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
	});

	it('swallows a throwing setItem so the live panel remains usable', async () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota exceeded');
		});
		const { writeStoredDetailPanelWidth } = await loadModule();

		expect(() => writeStoredDetailPanelWidth(440)).not.toThrow();
	});

	it('persists a collapsed rail by surface key and clears it on expansion', async () => {
		const {
			DETAIL_RAIL_STORAGE_KEY,
			readStoredDetailRail,
			writeStoredDetailRail,
			clearStoredDetailRail,
		} = await loadModule();

		writeStoredDetailRail('stop:52618');
		expect(DETAIL_RAIL_STORAGE_KEY).toBe('transit:detail-rail');
		expect(readStoredDetailRail()).toBe('stop:52618');

		clearStoredDetailRail();
		expect(readStoredDetailRail()).toBeNull();
	});

	it('on the server returns the default and does not touch storage', async () => {
		mocks.browser = false;
		const getItem = vi.spyOn(Storage.prototype, 'getItem');
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		const { readStoredDetailPanelWidth, writeStoredDetailPanelWidth, DEFAULT_DETAIL_PANEL_WIDTH } =
			await loadModule();

		expect(readStoredDetailPanelWidth()).toBe(DEFAULT_DETAIL_PANEL_WIDTH);
		writeStoredDetailPanelWidth(440);
		expect(getItem).not.toHaveBeenCalled();
		expect(setItem).not.toHaveBeenCalled();
		getItem.mockRestore();
		setItem.mockRestore();
	});
});

describe('mapDetailPanes rail-offset publication', () => {
	beforeEach(() => {
		document.documentElement.style.removeProperty('--app-effective-rail-offset');
		document.documentElement.style.removeProperty('--app-rail-offset-duration');
	});

	afterEach(() => {
		document.documentElement.style.removeProperty('--app-effective-rail-offset');
		document.documentElement.style.removeProperty('--app-rail-offset-duration');
	});

	it.each([
		{
			state: 'open',
			open: true,
			collapsed: false,
			expectedOffset: '440px',
		},
		{
			state: 'collapsed',
			open: true,
			collapsed: true,
			expectedOffset: '3.7rem',
		},
		{
			state: 'closed or mobile',
			open: false,
			collapsed: false,
			expectedOffset: '0px',
		},
	] as const)(
		'publishes the exact $state panel, map-chrome, and root offsets',
		async ({ open, collapsed, expectedOffset }) => {
			const { publishRailOffset } = await loadModule();
			const hero = document.createElement('div');

			publishRailOffset(hero, 440, open, collapsed, false);

			expect(hero.style.getPropertyValue('--app-right-detail-offset')).toBe('440px');
			expect(hero.style.getPropertyValue('--map-detail-offset')).toBe(expectedOffset);
			expect(document.documentElement.style.getPropertyValue('--app-effective-rail-offset')).toBe(
				expectedOffset,
			);
			expect(document.documentElement.style.getPropertyValue('--app-rail-offset-duration')).toBe(
				'',
			);
		},
	);

	it('publishes an instant drag duration, resets on cleanup, then restores the next target', async () => {
		const { publishRailOffset } = await loadModule();
		const hero = document.createElement('div');

		const cleanup = publishRailOffset(hero, 360, true, false, true);
		expect(document.documentElement.style.getPropertyValue('--app-effective-rail-offset')).toBe(
			'360px',
		);
		expect(document.documentElement.style.getPropertyValue('--app-rail-offset-duration')).toBe(
			'0ms',
		);

		cleanup();
		expect(document.documentElement.style.getPropertyValue('--app-effective-rail-offset')).toBe(
			'0px',
		);
		expect(document.documentElement.style.getPropertyValue('--app-rail-offset-duration')).toBe('');

		publishRailOffset(hero, 420, true, false, false);
		expect(document.documentElement.style.getPropertyValue('--app-effective-rail-offset')).toBe(
			'420px',
		);
		expect(hero.style.getPropertyValue('--map-detail-offset')).toBe('420px');
	});
});
