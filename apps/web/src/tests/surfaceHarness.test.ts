import { describe, expect, it, vi } from 'vitest';
import { createSurfaceHarness, type StoragePort } from './surfaceHarness';

function memoryStorage(initial: Record<string, string> = {}): StoragePort & {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
} {
	const values = new Map(Object.entries(initial));
	return {
		get length() {
			return values.size;
		},
		key(index) {
			return [...values.keys()][index] ?? null;
		},
		removeItem(key) {
			values.delete(key);
		},
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, value);
		},
	};
}

function basicHarness() {
	const state = {
		url: new URL('http://localhost/mutated'),
		locale: 'fr' as 'en' | 'fr',
	};
	const storage = memoryStorage({
		'transit.persisted:surface': 'closed',
		'transit.persisted:surface:child': 'closed',
		'test-only:surface:first': '1',
		'test-only:surface:second': '2',
		unrelated: 'keep',
	});
	const domainReset = vi.fn();
	const liveReset = vi.fn();
	const mockReset = vi.fn();
	const mount = vi.fn((name: string) => ({ name }));
	const harness = createSurfaceHarness({
		url: {
			initial: '/stop/57191',
			origin: 'http://localhost',
			set: (url) => {
				state.url = url;
			},
		},
		locale: {
			initial: 'en' as const,
			set: (locale) => {
				state.locale = locale;
			},
		},
		storage: [
			{
				port: storage,
				keys: ['transit.persisted:surface'],
				prefixes: ['test-only:surface:'],
			},
		],
		resetters: [domainReset, liveReset, mockReset],
		mount,
	});
	return { harness, state, storage, domainReset, liveReset, mockReset, mount };
}

describe('surface test lifecycle harness', () => {
	it('normalizes relative URL changes and restores the configured default', () => {
		const { harness, state } = basicHarness();

		const changed = harness.setUrl('/fr/network?grain=week#history');

		expect(changed.href).toBe('http://localhost/fr/network?grain=week#history');
		expect(state.url).toBe(changed);

		harness.reset();

		expect(state.url.href).toBe('http://localhost/stop/57191');
	});

	it('restores locale and removes only declared storage keys and prefixes', () => {
		const { harness, state, storage } = basicHarness();

		harness.reset();

		expect(state.locale).toBe('en');
		expect(storage.getItem('transit.persisted:surface')).toBeNull();
		expect(storage.getItem('transit.persisted:surface:child')).toBe('closed');
		expect(storage.getItem('test-only:surface:first')).toBeNull();
		expect(storage.getItem('test-only:surface:second')).toBeNull();
		expect(storage.getItem('unrelated')).toBe('keep');
	});

	it('runs every registered domain, live-store, and mock reset once per reset', () => {
		const { harness, domainReset, liveReset, mockReset } = basicHarness();

		harness.reset();

		expect(domainReset).toHaveBeenCalledOnce();
		expect(liveReset).toHaveBeenCalledOnce();
		expect(mockReset).toHaveBeenCalledOnce();
	});

	it('is idempotent while still invoking each reset contract on every call', () => {
		const { harness, state, storage, domainReset, liveReset, mockReset } = basicHarness();

		harness.reset();
		const firstUrl = state.url.href;
		harness.reset();

		expect(state.url.href).toBe(firstUrl);
		expect(state.locale).toBe('en');
		expect(storage.getItem('unrelated')).toBe('keep');
		expect(domainReset).toHaveBeenCalledTimes(2);
		expect(liveReset).toHaveBeenCalledTimes(2);
		expect(mockReset).toHaveBeenCalledTimes(2);
	});

	it('keeps separate harness instances isolated', () => {
		const first = basicHarness();
		const second = basicHarness();

		first.harness.setUrl('/first');
		first.state.locale = 'fr';
		first.storage.setItem('test-only:surface:first-only', '1');
		first.harness.reset();

		expect(first.state.url.pathname).toBe('/stop/57191');
		expect(second.state.url.pathname).toBe('/mutated');
		expect(second.state.locale).toBe('fr');
		expect(second.storage.getItem('test-only:surface:first-only')).toBeNull();
		expect(second.domainReset).not.toHaveBeenCalled();
	});

	it('delegates injected mount calls made directly and through suite-local helpers', () => {
		const { harness, mount } = basicHarness();
		const renderSurface = (name: string) => harness.mount(`surface:${name}`);

		expect(harness.mount('direct')).toEqual({ name: 'direct' });
		expect(renderSurface('helper')).toEqual({ name: 'surface:helper' });

		expect(mount.mock.calls).toEqual([['direct'], ['surface:helper']]);
	});
});
