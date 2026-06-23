import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// overlayWidth — the shared draggable-overlay width factory behind both the left
// nav rail and the right detail panel. Clamp + SSR-safe persist, parameterised by
// storage key + bounds.

const mocks = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));

const CONFIG = { key: 'transit:test-overlay', min: 200, max: 400, default: 256 };

async function loadFactory() {
	vi.resetModules();
	const { createOverlayWidth } = await import('./overlayWidth');
	return createOverlayWidth(CONFIG);
}

describe('createOverlayWidth.clamp', () => {
	it('keeps an in-range width unchanged', async () => {
		const o = await loadFactory();
		expect(o.clamp(256)).toBe(256);
		expect(o.clamp(300)).toBe(300);
	});

	it('raises a too-narrow width to the floor and caps a too-wide one', async () => {
		const o = await loadFactory();
		expect(o.clamp(40)).toBe(CONFIG.min);
		expect(o.clamp(9000)).toBe(CONFIG.max);
	});

	it('rounds to an integer px', async () => {
		const o = await loadFactory();
		expect(o.clamp(256.7)).toBe(257);
	});

	it('falls back to the default for non-finite input', async () => {
		const o = await loadFactory();
		expect(o.clamp(Number.NaN)).toBe(CONFIG.default);
		expect(o.clamp(Number.POSITIVE_INFINITY)).toBe(CONFIG.default);
	});
});

describe('createOverlayWidth persistence', () => {
	beforeEach(() => {
		mocks.browser = true;
		localStorage.clear();
	});
	afterEach(() => localStorage.clear());

	it('defaults to the configured default with no stored choice', async () => {
		const o = await loadFactory();
		expect(o.read()).toBe(CONFIG.default);
	});

	it('persists a chosen width and reads it back across a reload', async () => {
		const o = await loadFactory();
		o.write(300);
		expect(localStorage.getItem(CONFIG.key)).toBe('300');
		const reloaded = await loadFactory();
		expect(reloaded.read()).toBe(300);
	});

	it('clamps a persisted width that violates a bound', async () => {
		const o = await loadFactory();
		o.write(9000);
		expect(localStorage.getItem(CONFIG.key)).toBe(String(CONFIG.max));
	});

	it('falls back to the default for a junk stored value', async () => {
		const o = await loadFactory();
		localStorage.setItem(CONFIG.key, 'not-a-number');
		expect(o.read()).toBe(CONFIG.default);
	});

	it('on the server returns the default and does not touch storage', async () => {
		mocks.browser = false;
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const o = await loadFactory();
		expect(o.read()).toBe(CONFIG.default);
		o.write(300);
		expect(setItem).not.toHaveBeenCalled();
		setItem.mockRestore();
	});
});
