import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/v1/schemas';

const mocks = vi.hoisted(() => ({
	getManifest: vi.fn(),
	getLabels: vi.fn(),
}));

vi.mock('$lib/v1/repositories/manifest', () => ({ getManifest: mocks.getManifest }));
vi.mock('$lib/v1/repositories/labels', () => ({ getLabels: mocks.getLabels }));

import { bootV1, resolveLabel } from './boot';

describe('bootV1 request reuse', () => {
	beforeEach(() => {
		mocks.getManifest.mockReset();
		mocks.getLabels.mockReset();
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
