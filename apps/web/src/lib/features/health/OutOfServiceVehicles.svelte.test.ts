import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { VehicleSchema, ManifestSchema } from '#lib/v1/schemas/index.ts';
import OutOfServiceVehicles from './OutOfServiceVehicles.svelte';
const state = vi.hoisted(() => ({ vehicles: null as unknown, start: vi.fn(), stop: vi.fn() }));
vi.mock('#lib/v1/live/store.svelte.ts', () => ({ createLiveStore: vi.fn(() => state) }));
import { createLiveStore } from '#lib/v1/live/store.svelte.ts';
afterEach(cleanup);
const manifest = ManifestSchema.parse({
	attribution: 'test',
	dataset_version: 'test',
	display_name: 'STM',
	labels: {},
	surfaces: [],
	provider: 'stm',
	generated_utc: '2026-06-15T00:00:00Z',
	tz: 'America/Toronto',
	bbox: [-74, 45, -73, 46],
	files: { live: { ttl_s: 20, generated_utc: '2026-06-15T00:00:00Z' } },
});
describe.each(['stm', 'octranspo'])('%s status count', (provider) => {
	it.each(['en', 'fr'] as const)('shows the count in %s', (locale) => {
		state.vehicles = {
			vehicles: ['trip', null, ''].map((trip, i) =>
				VehicleSchema.parse({
					id: provider + i,
					trip,
					lat: 45.5,
					lon: -73.6,
					status: 'unknown',
					updated_utc: '2026-06-15T00:00:00Z',
				}),
			),
		};
		const view = render(OutOfServiceVehicles, { manifest: { ...manifest, provider }, locale });
		expect(
			view.getByText(
				locale === 'en' ? 'Out-of-service vehicles: 2' : /Véhicules hors service\s: 2/,
			),
		).toBeInTheDocument();
		expect(createLiveStore).toHaveBeenLastCalledWith(expect.objectContaining({ provider }), {
			families: ['vehicles'],
		});
		view.unmount();
		expect(state.stop).toHaveBeenCalled();
	});
	it('keeps unloaded data unknown', () => {
		state.vehicles = null;
		const view = render(OutOfServiceVehicles, { manifest, locale: 'en' });
		expect(view.queryByText(/Out-of-service vehicles/)).toBeNull();
		expect(view.queryByText(/—/)).toBeNull();
	});
});
