import { render as renderComponent, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLineDirectory } from '#lib/site/lineDirectory.ts';
import { routeNameFallback } from '#lib/site/absence.ts';
import { getRoute } from '#lib/v1/repositories/static.ts';
import type { TripsFile } from '#lib/v1/index.ts';
import TripDetail from './TripDetail.svelte';
import { tripCopy } from './trips.copy';
async function render(...args: Parameters<typeof renderComponent<typeof TripDetail>>) {
	const view = renderComponent(...args);
	if (tripsData) await screen.findByRole('heading', { level: 1 });
	return view;
}
const TRIPS_FILE = {
	generated_utc: '2026-06-15T12:00:00Z',
	trips: {
		t161: {
			status: 'late',
			route: '161',
			delay_min: 4,
			stops: [
				{ stop: 'sA', eta_utc: '2026-06-15T12:05:00Z', delay_min: 4 },
				{ stop: 'sB', eta_utc: '2026-06-15T12:12:00Z', delay_min: null },
			],
		},
		tEmpty: {
			status: 'on_time',
			route: '24',
			delay_min: 0,
			stops: [],
		},
		tBlank: {
			status: 'unknown',
			route: null,
			delay_min: null,
			stops: [],
		},
	},
} as unknown as TripsFile;
let tripsData: TripsFile | null = TRIPS_FILE;
let stopNames: { id: string; name: string }[] = [];
let reportStale = false;
let reportNotice: 'stale' | 'refresh-unavailable' | null = null;
vi.mock('#lib/v1/live/store.svelte.ts', () => ({
	LIVE_FAMILIES: ['vehicles', 'trips', 'departures', 'alerts', 'network'],
	createLiveStore: () => ({
		get trips() {
			return tripsData;
		},
		get generatedUtc() {
			return tripsData?.generated_utc ?? null;
		},
		ageSeconds: 300,
		get isStale() {
			return reportStale;
		},
		get familyStates() {
			return {
				trips: {
					active: true,
					retainedGeneration: tripsData?.generated_utc ?? null,
					phase: 'ready',
					health: {
						state:
							reportNotice === 'refresh-unavailable'
								? 'retrying'
								: reportNotice
									? 'retained-stale'
									: 'live',
						ageSeconds: 300,
						isStale: reportStale,
						retained: true,
						notice: reportNotice,
					},
				},
			};
		},
		error: null,
		loading: false,
		start: vi.fn(),
		stop: vi.fn(),
		refresh: vi.fn(),
	}),
}));
vi.mock('#lib/v1/repositories/static.ts', () => ({ getStopsIndex: vi.fn(), getRoute: vi.fn() }));
vi.mock('#lib/v1/boot.ts', () => ({
	getV1Context: () => ({
		manifest: { short_name: 'STM', display_name: 'STM', dataset_version: 'test' },
	}),
}));
vi.mock('#lib/v1/resource.svelte.ts', () => ({
	createResource: () => ({
		get data() {
			return { stops: stopNames };
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));
const clockStub = vi.hoisted(() => ({
	get now() {
		return Date.parse('2026-06-15T12:05:00Z');
	},
	get serverNow() {
		return Date.parse('2026-06-15T12:05:00Z');
	},
	subscribe: () => () => {},
}));
vi.mock('@yesid/ui/state', async (importOriginal) => ({
	...(await importOriginal<typeof import('@yesid/ui/state')>()),
	clock: clockStub,
}));

beforeEach(() => {
	tripsData = TRIPS_FILE;
	vi.mocked(getRoute).mockResolvedValue(null);
	stopNames = [];
	reportStale = false;
	reportNotice = null;
});

describe.each(['en', 'fr'] as const)('TripDetail summary in %s', (locale) => {
	const context = new Map([[Symbol.for('@yesid/ui/locale'), () => locale]]);
	it('shows the trip identifier once when no line is reported', async () => {
		const { container } = await render(TripDetail, { props: { id: 'tBlank' }, context });
		expect(
			screen.getByRole('heading', { level: 1, name: tripCopy[locale].heading('tBlank') }),
		).toBeInTheDocument();
		const visible = container.cloneNode(true) as HTMLElement;
		visible.querySelectorAll('.sr-only,[aria-hidden="true"]').forEach((node) => node.remove());
		expect(visible.textContent?.match(/tBlank/g)).toHaveLength(1);
	});
	it('keeps a prediction caveat without inventing its source', async () => {
		const { container } = await render(TripDetail, { props: { id: 't161' }, context });
		expect(container.querySelector('.trip-prediction-caveat')).toHaveTextContent(
			locale === 'fr'
				? 'Les prédictions couvrent jusqu’à une heure au moment de la préparation du rapport. Elles peuvent changer.'
				: 'Predictions cover up to one hour when the report is prepared. They may change.',
		);
	});
	it('states on time once when the reported delay is exactly zero', async () => {
		const { container } = await render(TripDetail, { props: { id: 'tEmpty' }, context });
		const verdict = container.querySelector('.trip-verdict')!;
		expect(within(verdict as HTMLElement).getAllByText(tripCopy[locale].onTime)).toHaveLength(1);
		expect(verdict.querySelector('.trip-verdict-delay')).toHaveTextContent('0 min');
		expect(container.textContent).not.toMatch(/\/v1|never invented|jamais inventé/);
	});

	it.each([
		['on_time', 1, '+1 min'],
		['late', 0, '0 min'],
		['early', -2, '−2 min'],
		['severe', 4, '+4 min'],
		['unknown', 0, '0 min'],
		['on_time', null, null],
		['unknown', null, null],
	] as const)(
		'uses published %s with neutral measurement %s',
		async (status, delay, measurement) => {
			tripsData = {
				...TRIPS_FILE,
				trips: { probe: { status, delay_min: delay, route: '24', stops: [] } },
			} as TripsFile;
			const { container } = await render(TripDetail, { props: { id: 'probe' }, context });
			const verdict = container.querySelector('.trip-verdict') as HTMLElement;
			const badge = verdict.querySelector('[data-slot="status-badge"]')!;
			if (status === 'unknown' && delay == null) {
				expect(
					verdict.textContent?.match(new RegExp(tripCopy[locale].status.unknown, 'g')),
				).toHaveLength(1);
				const probe = document.createElement('button');
				probe.innerHTML = verdict.innerHTML;
				document.body.append(probe);
				try {
					expect(probe).toHaveAccessibleName(
						locale === 'en'
							? 'Unknown, not reported in the live feed'
							: 'Inconnu, non signalé dans le flux en direct',
					);
				} finally {
					probe.remove();
				}
			}

			expect(badge).toHaveAttribute('data-status', status);
			if (status === 'unknown' && delay == null) {
				expect(badge).toHaveAttribute('aria-hidden', 'true');
				expect(badge).toHaveTextContent('○');
				expect(badge?.getAttribute('style')).toContain('--dataviz-status-unknown');
			} else expect(badge).toHaveTextContent(tripCopy[locale].status[status]);
			expect(badge.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
			const reading = verdict.querySelector('.trip-verdict-delay')!;
			expect(reading).not.toHaveAttribute('data-tone');
			if (measurement) expect(reading).toHaveTextContent(measurement);
			else expect(reading.querySelector('[data-slot="absent-value"]')).toBeInTheDocument();
			expect(reading.textContent).not.toMatch(/late|early|On time|retard|avance|heure/);
		},
	);
});

describe('TripDetail: a broadcasting trip', () => {
	it('renders the trip heading, route link, status and current delay', async () => {
		await render(TripDetail, { props: { id: 't161' } });

		expect(screen.getByRole('heading', { name: 'Line 161' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Line 161' })).toHaveAttribute('href', '/lines/161');
		expect(screen.getByText('Late')).toBeInTheDocument();
		expect(screen.getAllByText('4 min late').length).toBeGreaterThanOrEqual(1);
	});

	it('shows the trip identifier once without breadcrumbs', async () => {
		const { container } = await render(TripDetail, { props: { id: 't161' } });
		expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
		const visible = container.cloneNode(true) as HTMLElement;
		visible.querySelectorAll('.sr-only,[aria-hidden="true"]').forEach((node) => node.remove());
		expect(visible.textContent?.match(/t161/g)).toHaveLength(1);
	});

	it('anchors the FreshnessStamp age to the SERVER clock (serverNow), not Date.now()', async () => {
		await render(TripDetail, { props: { id: 't161' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(within(chip).getByText('5 minutes ago')).toBeInTheDocument();
		expect(chip.querySelector('time')).toHaveAttribute('datetime', '2026-06-15T12:00:00Z');
	});

	it('frames each reported ETA as a prediction with an honest delay basis', async () => {
		await render(TripDetail, { props: { id: 't161' } });

		const stops = screen.getByRole('list', { name: 'Reported predictions for this trip' });
		expect(within(stops).getByRole('link', { name: /^View stop sA / })).toHaveAttribute(
			'href',
			'/stop/sA',
		);
		expect(within(stops).getAllByText('Prediction').length).toBe(2);
	});

	it('shows the delay basis when present and the styled honest-absence chip when null, never 0', async () => {
		await render(TripDetail, { props: { id: 't161' } });

		const stops = screen.getByRole('list', { name: 'Reported predictions for this trip' });
		expect(within(stops).getAllByText('4 min late').length).toBeGreaterThanOrEqual(1);
		const absent = within(stops).getByText('not reported in the live feed');
		expect(absent.closest('[data-slot="absent-value"]')).not.toBeNull();
		expect(within(stops).queryByText('0 min late')).not.toBeInTheDocument();
	});

	it('renders the styled honest-absence chip when a broadcasting trip omits route + delay', async () => {
		await render(TripDetail, { props: { id: 'tBlank' } });
		expect(screen.getByRole('heading', { name: 'Trip tBlank' })).toBeInTheDocument();
		const chips = screen.getAllByText('not reported in the live feed');
		expect(chips.length).toBe(2);
		for (const chip of chips) {
			expect(chip.closest('[data-slot="absent-value"]')).not.toBeNull();
		}
		expect(screen.queryByText('No line reported')).not.toBeInTheDocument();
	});

	it('renders an honest note when a broadcasting trip reports no predictions', async () => {
		await render(TripDetail, { props: { id: 'tEmpty' } });

		const empty = screen.getByTestId('trip-no-stops');
		expect(empty).toBeInTheDocument();
		expect(empty).toHaveAttribute('data-slot', 'state-notice');
		expect(empty).toHaveAttribute('data-presentation', 'silo');
		expect(
			screen.queryByRole('list', { name: 'Reported predictions for this trip' }),
		).not.toBeInTheDocument();
	});
});

describe('TripDetail: stand-down honesty', () => {
	it('stands down when the trip id is absent from the retained report', async () => {
		await render(TripDetail, { props: { id: 'tGhost' } });

		expect(screen.getByTestId('trip-standdown')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Trip not in this report' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Trip tGhost' })).not.toBeInTheDocument();
	});

	it('stands down when no report has loaded', async () => {
		tripsData = null;
		await render(TripDetail, { props: { id: 't161' } });
		expect(screen.queryByRole('heading', { name: 'Trip t161' })).not.toBeInTheDocument();
		expect(screen.queryByTestId('trip-standdown')).not.toBeInTheDocument();
	});
});

describe.each(['en', 'fr'] as const)('TripDetail report scope in %s', (locale) => {
	const context = new Map([[Symbol.for('@yesid/ui/locale'), () => locale]]);
	it('keeps the full long stop name available in either language', async () => {
		const name =
			'Station Université de Montréal / Boulevard Édouard-Montpetit et chemin de la Côte-des-Neiges';
		stopNames = [{ id: 'sA', name }];
		await render(TripDetail, { props: { id: 't161' }, context });
		const link = screen.getByRole('link', { name: new RegExp(name) });
		expect(link).toHaveAccessibleName(expect.stringContaining(name));
		expect(within(link).getByTitle(name)).toHaveTextContent(name);
	});
	it('counts prediction rows without claiming a last reported stop', async () => {
		const { container } = await render(TripDetail, { props: { id: 't161' }, context });
		const stop = screen.getByRole('link', { name: /sA/ });
		expect(stop).toHaveAccessibleName(
			`${locale === 'en' ? 'View stop' : 'Voir l’arrêt'} sA ${stop.querySelector('time')!.textContent} ${tripCopy[locale].predictionLabel} ${locale === 'en' ? '4 min late' : '4 min en retard'}`,
		);
		expect(container.querySelector('.trip-last-stop-name')).not.toBeInTheDocument();
		expect(container.querySelectorAll('.trip-stop')).toHaveLength(2);
		expect(container.querySelector('.trip-prediction-count')).toHaveTextContent(
			locale === 'fr' ? '2 prédictions communiquées' : '2 predictions reported',
		);
		expect(container.textContent).not.toMatch(/Last reported stop|Dernier arrêt communiqué/);
		expect(container.textContent).not.toMatch(/Destination|stops remaining|arrêts restants/);
	});
	it.each([false, true])(
		'retains report-specific absence and timestamp when stale=%s',
		async (stale) => {
			reportStale = stale;
			reportNotice = stale ? 'stale' : null;
			await render(TripDetail, { props: { id: 'tGhost' }, context });
			const stamp = document.querySelector('[data-slot="freshness-stamp"]')!;
			expect(stamp).toHaveAttribute('data-variant', stale ? 'updated' : 'live');
			expect(document.querySelector('.freshness-stamp-stale')).toBeNull();
			expect(stamp.querySelector('time')).toHaveAttribute('datetime', TRIPS_FILE.generated_utc);
			expect(screen.queryByTestId('trip-report-notice') !== null).toBe(stale);
		},
	);
	it('warns on failed refresh without classifying a recent retained report as stale', async () => {
		reportNotice = 'refresh-unavailable';
		await render(TripDetail, { props: { id: 't161' }, context });
		const stamp = document.querySelector('[data-slot="freshness-stamp"]')!;
		expect(stamp).toHaveAttribute('data-variant', 'updated');
		expect(stamp).not.toHaveAttribute('data-stale');
		expect(screen.getByTestId('trip-report-notice')).toHaveTextContent(
			locale === 'fr' ? 'Actualisation indisponible' : 'Refresh unavailable',
		);
		expect(document.querySelectorAll('.trip-stop-link')).toHaveLength(2);
	});
});

describe.each(['en', 'fr'] as const)('missing trip fields follow health (%s)', (locale) => {
	for (const notice of ['stale', 'refresh-unavailable'] as const)
		it(notice, async () => {
			reportNotice = notice;
			reportStale = notice === 'stale';
			const { container } = await render(TripDetail, {
				props: { id: 'tBlank' },
				context: new Map([[Symbol.for('@yesid/ui/locale'), () => locale]]),
			});
			const missing = container.querySelector('[data-slot="absent-value"]');
			expect(missing).toHaveAccessibleName(
				expect.stringContaining(
					locale === 'en'
						? notice === 'stale'
							? 'Report behind'
							: 'Refresh unavailable'
						: notice === 'stale'
							? 'Rapport en retard'
							: 'Indisponible',
				),
			);
		});
});

describe.each(['en', 'fr'] as const)('trip line title in %s', (locale) => {
	it.each(['24', '1-373', '80'])(
		'titles a trip by its line and links back to it (%s)',
		async (route) => {
			const directory = createLineDirectory(
				[
					{ id: '24', short: '24' },
					{ id: '1-373', short: '1' },
				],
				{ line: (id) => routeNameFallback(id, locale) },
			);
			const name = directory.spoken(directory.number(route));
			tripsData = { ...TRIPS_FILE, trips: { probe: { ...TRIPS_FILE.trips.t161, route } } };
			vi.mocked(getRoute).mockResolvedValue({
				directions: [
					{
						dir: 0,
						headsign: 'Terminal',
						stops: [
							{ id: 'sA', seq: 1 },
							{ id: 'sB', seq: 2 },
						],
					},
				],
			} as Awaited<ReturnType<typeof getRoute>>);
			const { container, unmount } = await render(TripDetail, {
				props: { id: 'probe' },
				context: new Map<symbol, unknown>([
					[Symbol.for('@yesid/ui/locale'), () => locale],
					[Symbol.for('transit.line-directory'), () => directory],
				]),
			});
			expect(
				await screen.findByRole('heading', { level: 1, name: name + ' · Terminal' }),
			).toBeInTheDocument();
			expect(screen.getByRole('link', { name: tripCopy[locale].backLine(name) })).toHaveAttribute(
				'href',
				(locale === 'fr' ? '/fr' : '') + '/lines/' + route,
			);
			const meta = screen.getByText(tripCopy[locale].heading('probe'), { exact: true });
			expect(meta.parentElement?.firstElementChild).toBe(meta);
			expect(container.textContent).not.toMatch(/Departure|Départ/);
			unmount();
			vi.mocked(getRoute).mockResolvedValue(null);
			await render(TripDetail, {
				props: { id: 'probe' },
				context: new Map<symbol, unknown>([
					[Symbol.for('@yesid/ui/locale'), () => locale],
					[Symbol.for('transit.line-directory'), () => directory],
				]),
			});
			expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
		},
	);
});
