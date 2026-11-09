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

// Glossary: Live age and the page banner never include service alerts; a stale
// alert capture is reported beside the alerts, not as a page-level stall.
it.each(['en', 'fr'] as const)(
	'keeps the page banner idle when only the alert capture is stale in %s',
	async (locale) => {
		const now = new Date();
		vi.spyOn(adapter.live, 'vehicles').mockResolvedValue(
			VehiclesFileSchema.parse({ generated_utc: now.toISOString(), vehicles: [] }),
		);
		vi.spyOn(adapter.live, 'alerts').mockResolvedValue(
			AlertsFileSchema.parse({
				generated_utc: now.toISOString(),
				feed_captured_utc: new Date(+now - 901_000).toISOString(),
				alerts: [],
			}),
		);
		const { container } = render(HealthPresentation, { props: { locale } });
		const stamp = container.querySelector('[data-slot="freshness-stamp"]');
		await waitFor(() => expect(stamp).toHaveAttribute('data-age-seconds'));
		const banner = screen.getByRole('status');
		expect(banner).toHaveAttribute('data-state', 'idle');
		expect(banner.textContent?.trim()).toBe('');
		expect(stamp).toHaveAttribute('data-stale', 'false');
	},
);

it.each(['en', 'fr'] as const)(
	'keeps whole-feed outage wording when all publications stall in %s',
	async (locale) => {
		const generated_utc = new Date(Date.now() - 901_000).toISOString();
		vi.spyOn(adapter.live, 'vehicles').mockResolvedValue(
			VehiclesFileSchema.parse({ generated_utc, vehicles: [] }),
		);
		vi.spyOn(adapter.live, 'alerts').mockResolvedValue(
			AlertsFileSchema.parse({ generated_utc, alerts: [] }),
		);
		render(HealthPresentation, { props: { locale } });
		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent(
				locale === 'en' ? 'Live feed not responding' : 'Le flux en direct ne répond pas',
			),
		);
	},
);

it('does not report a stall from stale alerts while vehicles have never loaded', async () => {
	const now = new Date();
	let finishVehicles!: (value: VehiclesFile) => void;
	const pending = new Promise<VehiclesFile>((resolve) => {
		finishVehicles = resolve;
	});
	const vehicles = VehiclesFileSchema.parse({ generated_utc: now.toISOString(), vehicles: [] });
	vi.spyOn(adapter.live, 'vehicles').mockReturnValue(pending);
	vi.spyOn(adapter.live, 'alerts').mockResolvedValue(
		AlertsFileSchema.parse({
			generated_utc: now.toISOString(),
			feed_captured_utc: new Date(+now - 901_000).toISOString(),
			alerts: [],
		}),
	);
	try {
		render(HealthPresentation);
		const banner = screen.getByRole('status');
		await waitFor(() => expect(adapter.live.alerts).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(banner).toHaveAttribute('data-state', 'idle');
		expect(banner).not.toHaveTextContent(/not responding|out of date/);
	} finally {
		finishVehicles(vehicles);
		await pending;
	}
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
