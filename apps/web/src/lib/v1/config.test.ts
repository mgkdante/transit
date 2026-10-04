import { describe, expect, it, vi } from 'vitest';
import { normalizeSnapshotPointer, normalizeV1BaseUrl, resolveUrl } from './config';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_V1_BASE: 'https://r2.example.test/v1',
		PUBLIC_V1_PROVIDER: 'stm',
	},
}));

describe('normalizeV1BaseUrl', () => {
	it('keeps absolute URL bases and same-origin absolute paths stable', () => {
		expect(normalizeV1BaseUrl('https://transit.yesid.dev/data/v1')).toBe(
			'https://transit.yesid.dev/data/v1',
		);
		expect(normalizeV1BaseUrl('/data/v1/')).toBe('/data/v1');
	});

	it('promotes bare relative data bases to root-relative paths', () => {
		expect(normalizeV1BaseUrl('data/v1')).toBe('/data/v1');
		expect(normalizeV1BaseUrl('')).toBe('/data/v1');
	});

	it('rebases a canonical Transit manifest pointer onto the configured snapshot base', () => {
		expect(
			resolveUrl(
				'https://transit.yesid.dev/data/v1/stm/static/basemap.json?generation=42#descriptor',
			),
		).toBe('https://r2.example.test/v1/stm/static/basemap.json?generation=42#descriptor');
	});

	it.each([
		'https://cdn.example.test/data/v1/stm/static/basemap.json',
		'https://transit.yesid.dev/data/v1/exo/static/basemap.json',
		'///data/v1/stm/static/basemap.json',
		'../octranspo/manifest.json',
	])('rejects pointers outside the selected provider: %s', (pointer) => {
		expect(() => resolveUrl(pointer, 'stm')).toThrow();
	});

	it('resolves ordinary and canonical pointers for the explicit provider', () => {
		for (const path of ['live/vehicles.json', '/data/v1/octranspo/live/vehicles.json']) {
			expect(resolveUrl(path, 'octranspo')).toBe(
				'https://r2.example.test/v1/octranspo/live/vehicles.json',
			);
		}
	});

	it.each(['https://r2.example.test/v1/stm/static/basemap.json?generation=42#descriptor'])(
		'preserves an already-direct or non-HTTP pointer byte-for-byte: %s',
		(pointer) => {
			expect(normalizeSnapshotPointer(pointer)).toBe(pointer);
		},
	);
});
