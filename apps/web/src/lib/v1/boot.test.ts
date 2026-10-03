import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/v1/schemas';

const mocks = vi.hoisted(() => ({
	getManifest: vi.fn(),
	getLabels: vi.fn(),
}));

vi.mock('$lib/v1/repositories/manifest', () => ({ getManifest: mocks.getManifest }));
vi.mock('$lib/v1/repositories/labels', () => ({ getLabels: mocks.getLabels }));

import { bootV1, bootProvider, resolveLabel } from './boot';

describe('bootV1 request reuse', () => {
	beforeEach(() => {
		mocks.getManifest.mockReset();
		mocks.getLabels.mockReset();
	});

	it.each([503, 200])(
		'preserves an explicit nondefault selection when discovery is unavailable or corrupt (%s)',
		async (status) => {
			const fetch = vi.fn(async () => new Response('{}', { status }));
			const url = new URL('https://transit.test/fr/map?provider=octranspo');
			const result = await bootProvider(url, 'fr', { fetch });
			expect(result).toMatchObject({
				providerId: 'octranspo',
				v1: null,
				discoveryError: true,
				redirectHref: null,
			});
			expect(url.search).toBe('?provider=octranspo');
			expect(mocks.getManifest).not.toHaveBeenCalled();
			expect(fetch).toHaveBeenCalledExactlyOnceWith('/data/v1/providers.json');
		},
	);

	it('limits discovery-outage compatibility to the default provider manifest', async () => {
		mocks.getManifest.mockResolvedValue({ provider: 'stm', city: 'Montréal', display_name: 'STM' });
		mocks.getLabels.mockResolvedValue({});
		const fetch = vi.fn(async () => new Response(null, { status: 503 }));
		const result = await bootProvider(new URL('https://transit.test/network'), 'en', { fetch });
		expect(result.v1?.manifest.provider).toBe('stm');
		expect(result.provider?.labels.en.city).toBe('Montréal');
		expect(mocks.getManifest).toHaveBeenCalledWith({ fetch, providerId: 'stm' });
	});

	it('keeps manifest label pointers out of the resolved label table', async () => {
		const manifest = {
			labels: { fr: 'labels/fr.json', en: 'labels/en.json' },
			files: { live: { generated_utc: '2026-07-15T12:00:00Z' } },
		} as unknown as Manifest;
		const request = vi.fn();
		const cache = new Map<string, unknown>();
		mocks.getManifest.mockResolvedValue(manifest);
		mocks.getLabels.mockResolvedValue({
			'metric.local': 'Local metric',
			'status.local': 'Local status',
			'severity.local': 'Local severity',
			'occupancy.local': 'Local occupancy',
			'methodology.local': 'Local methodology',
		});

		const context = await bootV1('en', { fetch: request, cache });

		expect(context.manifest).toBe(manifest);
		expect(context.labels).not.toHaveProperty('fr');
		expect(context.labels).not.toHaveProperty('en');
		expect([
			resolveLabel('metric.local', context.labels),
			resolveLabel('status.local', context.labels),
			resolveLabel('severity.local', context.labels),
			resolveLabel('occupancy.local', context.labels),
			resolveLabel('methodology.local', context.labels),
		]).toEqual([
			'Local metric',
			'Local status',
			'Local severity',
			'Local occupancy',
			'Local methodology',
		]);

		expect(mocks.getLabels).toHaveBeenCalledWith('en', {
			fetch: request,
			cache,
			manifest,
		});
	});
});
