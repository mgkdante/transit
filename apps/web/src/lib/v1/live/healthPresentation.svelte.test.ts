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

it.each([
	['en', 'Data may be out of date.'],
	['fr', 'Les données peuvent ne plus être à jour.'],
] as const)(
	'renders a partial alert capture stall honestly in %s through the real store',
	async (locale, message) => {
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
		render(HealthPresentation, { props: { locale } });
		await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
		expect(screen.getByRole('status')).not.toHaveTextContent(
			/not responding|ne répond pas|Last update|Dernière mise à jour/,
		);
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

it('does not call the whole feed unresponsive while another family has never loaded', async () => {
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
		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Data may be out of date.'),
		);
		expect(screen.getByRole('status')).not.toHaveTextContent('not responding');
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
