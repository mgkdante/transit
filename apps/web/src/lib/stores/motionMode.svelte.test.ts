import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// motionMode — the honest raw/smooth bus-drawing switch. RAW is the default
// (never estimate a position the feed did not report); SMOOTH opts into
// forward-projection. The choice persists to localStorage so it sticks across
// reloads, and reads back SSR-safe to 'raw' when storage is absent/disabled.

const mocks = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));

async function loadMotionMode() {
	vi.resetModules();
	return import('./motionMode.svelte');
}

describe('motionMode', () => {
	beforeEach(() => {
		mocks.browser = true;
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	it('defaults to RAW with no stored choice', async () => {
		const { motionMode } = await loadMotionMode();
		expect(motionMode.current).toBe('raw');
		expect(motionMode.isSmooth).toBe(false);
	});

	it('toggle flips raw -> smooth and persists to localStorage', async () => {
		const { motionMode, MOTION_MODE_STORAGE_KEY } = await loadMotionMode();

		motionMode.toggle();

		expect(motionMode.current).toBe('smooth');
		expect(motionMode.isSmooth).toBe(true);
		expect(localStorage.getItem(MOTION_MODE_STORAGE_KEY)).toBe('smooth');
	});

	it('toggle flips smooth -> raw and persists', async () => {
		const { motionMode, MOTION_MODE_STORAGE_KEY } = await loadMotionMode();

		motionMode.toggle();
		motionMode.toggle();

		expect(motionMode.current).toBe('raw');
		expect(localStorage.getItem(MOTION_MODE_STORAGE_KEY)).toBe('raw');
	});

	it('set writes the chosen mode and persists it', async () => {
		const { motionMode, MOTION_MODE_STORAGE_KEY } = await loadMotionMode();

		motionMode.set('smooth');

		expect(motionMode.current).toBe('smooth');
		expect(localStorage.getItem(MOTION_MODE_STORAGE_KEY)).toBe('smooth');
	});

	it('restores a persisted SMOOTH choice on (re)load', async () => {
		const { MOTION_MODE_STORAGE_KEY } = await loadMotionMode();
		localStorage.setItem(MOTION_MODE_STORAGE_KEY, 'smooth');

		// A fresh module load (a page reload) seeds from the persisted value.
		const { motionMode } = await loadMotionMode();
		expect(motionMode.current).toBe('smooth');
	});

	it('falls back to RAW for an unrecognized stored value', async () => {
		const { MOTION_MODE_STORAGE_KEY } = await loadMotionMode();
		localStorage.setItem(MOTION_MODE_STORAGE_KEY, 'garbage');

		const { motionMode } = await loadMotionMode();
		expect(motionMode.current).toBe('raw');
	});

	it('on the server defaults to RAW and does not touch storage', async () => {
		mocks.browser = false;
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		const { motionMode } = await loadMotionMode();
		expect(motionMode.current).toBe('raw');

		motionMode.set('smooth');
		// State still updates (reactive), but persistence is browser-guarded.
		expect(motionMode.current).toBe('smooth');
		expect(setItem).not.toHaveBeenCalled();
		setItem.mockRestore();
	});
});
