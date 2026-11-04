import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { adapter } from '#lib/v1/adapter/index.ts';
import { AlertsFileSchema, VehiclesFileSchema } from '#lib/v1/schemas/index.ts';
import type { AlertsFile, VehiclesFile } from '#lib/v1/schemas/index.ts';
import HealthPresentation from './__fixtures__/HealthPresentation.svelte';

vi.mock('$app/env/public', async () => ({
	...(await import('./../../../tests/publicEnv.ts')).PUBLIC_ENV,
	...{},
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it('keeps the real banner idle before first loads resolve and while alerts are still never-loaded', async () => {
	const generatedUtc = new Date().toISOString();
	let finishVehicles!: () => void;
	let finishAlerts!: () => void;
	const vehicles = new Promise<VehiclesFile>((resolve) => {
		finishVehicles = () =>
			resolve(VehiclesFileSchema.parse({ generated_utc: generatedUtc, vehicles: [] }));
	});
	const alerts = new Promise<AlertsFile>((resolve) => {
		finishAlerts = () =>
			resolve(AlertsFileSchema.parse({ generated_utc: generatedUtc, alerts: [] }));
	});
	vi.spyOn(adapter.live, 'vehicles').mockReturnValue(vehicles);
	vi.spyOn(adapter.live, 'alerts').mockReturnValue(alerts);
	try {
		const { container } = render(HealthPresentation);
		const banner = screen.getByRole('status');
		const stamp = container.querySelector('[data-slot="freshness-stamp"]');
		expect(banner).toHaveAttribute('data-state', 'idle');
		expect(banner.textContent?.trim()).toBe('');
		expect(stamp).toHaveAttribute('data-stale', 'false');
		finishVehicles();
		await waitFor(() => expect(stamp).toHaveAttribute('data-age-seconds'));
		expect(banner).toHaveAttribute('data-state', 'idle');
		expect(banner.textContent?.trim()).toBe('');
		expect(stamp).toHaveAttribute('data-stale', 'false');
	} finally {
		finishVehicles();
		finishAlerts();
		await Promise.all([vehicles, alerts]);
	}
});
