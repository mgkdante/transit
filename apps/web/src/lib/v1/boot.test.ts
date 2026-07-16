import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/v1/schemas';

const mocks = vi.hoisted(() => ({
	getManifest: vi.fn(),
	getLabels: vi.fn(),
}));

vi.mock('$lib/v1/repositories', () => ({
	getManifest: mocks.getManifest,
	getLabels: mocks.getLabels,
}));

import { bootV1 } from './boot';

describe('bootV1 request reuse', () => {
	beforeEach(() => {
		mocks.getManifest.mockReset();
		mocks.getLabels.mockReset();
	});

	it('threads the authoritative boot manifest into the labels read', async () => {
		const manifest = {
			labels: { 'metric.base': 'Base label' },
			files: { live: { generated_utc: '2026-07-15T12:00:00Z' } },
		} as unknown as Manifest;
		const request = vi.fn();
		const cache = new Map<string, unknown>();
		mocks.getManifest.mockResolvedValue(manifest);
		mocks.getLabels.mockResolvedValue({ 'metric.local': 'Local label' });

		await expect(bootV1('en', { fetch: request, cache })).resolves.toMatchObject({
			manifest,
			labels: {
				'metric.base': 'Base label',
				'metric.local': 'Local label',
			},
		});

		expect(mocks.getLabels).toHaveBeenCalledWith('en', {
			fetch: request,
			cache,
			manifest,
		});
	});
});
