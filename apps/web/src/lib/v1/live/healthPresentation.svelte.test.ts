import { createMemoryLiveReader } from './__fixtures__/reader';
const reader = createMemoryLiveReader();
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

import { ManifestSchema, AlertsFileSchema, VehiclesFileSchema } from '#lib/v1/schemas/index.ts';
import { createLiveStore } from './store.svelte';
import { livePresentation } from './livePresentation';

vi.mock('$app/env/public', async () => ({
	...(await import('./../../../tests/publicEnv.ts')).PUBLIC_ENV,
}));
afterEach(() => vi.restoreAllMocks());
const manifest = ManifestSchema.parse({
	provider: 'stm',
	display_name: 'STM',
	dataset_version: 'health-test',
	attribution: 'Test',
	bbox: [-74, 45, -73, 46],
	labels: {},
	surfaces: [],
	files: { live: { generated_utc: '2026-06-21T12:00:00Z', ttl_s: 30 } },
});

it.each(['en', 'fr'] as const)(
	'passes store Feed health through the presentation interface in %s',
	async (locale) => {
		let live!: ReturnType<typeof createLiveStore>;
		const dispose = $effect.root(() => {
			live = createLiveStore(manifest, reader, { families: ['vehicles', 'alerts'] });
			return () => live.stop();
		});
		const present = () =>
			livePresentation({
				familyStates: live.familyStates,
				families: ['vehicles', 'alerts'],
				locale,
				page: 'map',
			});
		try {
			expect(present().notice.kind).toBe('none');
			expect(present().stamp).toMatchObject({ ageSeconds: null, isStale: false });
			const now = new Date();
			vi.spyOn(reader, 'vehicles').mockResolvedValue(
				VehiclesFileSchema.parse({ generated_utc: now.toISOString(), vehicles: [] }),
			);
			vi.spyOn(reader, 'alerts').mockResolvedValue(
				AlertsFileSchema.parse({
					generated_utc: now.toISOString(),
					feed_captured_utc: new Date(+now - 901000).toISOString(),
					alerts: [],
				}),
			);
			await live.refresh();
			flushSync();
			expect(live.familyStates.alerts.health.isStale).toBe(true);
			expect(present().notice.kind).toBe('none');
			expect(present().stamp.isStale).toBe(false);
			expect(present().stamp.ageSeconds).not.toBeNull();
			const old = new Date(+now - 901000).toISOString();
			vi.mocked(reader.vehicles).mockResolvedValue(
				VehiclesFileSchema.parse({ generated_utc: old, vehicles: [] }),
			);
			vi.mocked(reader.alerts).mockResolvedValue(
				AlertsFileSchema.parse({ generated_utc: old, alerts: [] }),
			);
			await live.refresh();
			flushSync();
			expect(present().notice.kind).toBe('whole-feed-stall');
			expect(present().notice.message).toContain(
				locale === 'en' ? 'Live feed not responding' : 'Le flux en direct ne répond pas',
			);
		} finally {
			dispose();
		}
	},
);

it('keeps the notice empty while vehicles are pending and alert capture is stale', async () => {
	let live!: ReturnType<typeof createLiveStore>;
	const dispose = $effect.root(() => {
		live = createLiveStore(manifest, reader, { families: ['vehicles', 'alerts'] });
		return () => live.stop();
	});
	let finish!: (value: ReturnType<typeof VehiclesFileSchema.parse>) => void;
	const now = new Date();
	const vehicle = VehiclesFileSchema.parse({ generated_utc: now.toISOString(), vehicles: [] });
	vi.spyOn(reader, 'vehicles').mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	vi.spyOn(reader, 'alerts').mockResolvedValue(
		AlertsFileSchema.parse({
			generated_utc: now.toISOString(),
			feed_captured_utc: new Date(+now - 901000).toISOString(),
			alerts: [],
		}),
	);
	const pending = live.refresh();
	try {
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(live.familyStates.alerts.health.isStale).toBe(true);
		expect(
			livePresentation({
				familyStates: live.familyStates,
				families: ['vehicles', 'alerts'],
				locale: 'en',
				page: 'map',
			}).notice.kind,
		).toBe('none');
	} finally {
		finish(vehicle);
		await pending;
		dispose();
	}
});
