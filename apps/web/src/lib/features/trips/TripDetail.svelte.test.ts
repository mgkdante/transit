import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripsFile } from '$lib/v1';
import TripDetail from './TripDetail.svelte';
import { tripCopy } from './trips.copy';
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
vi.mock('$lib/v1/repositories/live', () => ({ getTrips: vi.fn() }));
let reportStale = false;
let reportFailures = 0;
vi.mock('$lib/v1/live/store.svelte', () => ({
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
			return { trips: { phase: 'ready', consecutiveFailures: reportFailures } };
		},
		error: null,
		loading: false,
		start: vi.fn(),
		stop: vi.fn(),
		refresh: vi.fn(),
	}),
}));
vi.mock('$lib/v1/repositories/static', () => ({ getStopsIndex: vi.fn() }));
vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({
		manifest: { short_name: 'STM', display_name: 'STM', dataset_version: 'test' },
	}),
}));
// The optional stop-name lookup deliberately falls back to raw IDs in this fixture.
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		get data() {
			return tripsData;
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));
// Pin server time five minutes after generation, independent of client wall time.
const clockStub = vi.hoisted(() => ({
	get now() {
		return Date.parse('2026-06-15T12:05:00Z');
	},
	get serverNow() {
		return Date.parse('2026-06-15T12:05:00Z');
	},
	subscribe: () => () => {},
}));
vi.mock('$lib/stores/clock.svelte', () => ({ sharedClock: clockStub }));
vi.mock('$lib/stores', () => ({ sharedClock: clockStub }));

beforeEach(() => {
	tripsData = TRIPS_FILE;
	reportStale = false;
	reportFailures = 0;
});

describe.each(['en', 'fr'] as const)('TripDetail summary in %s', (locale) => {
	const context = new Map([[Symbol.for('transit.i18n.locale'), () => locale]]);
	it('keeps a prediction caveat without inventing its source', () => {
		const { container } = render(TripDetail, { props: { id: 't161' }, context });
		expect(container.querySelector('.trip-prediction-caveat')).toHaveTextContent(
			locale === 'fr'
				? 'Les prédictions couvrent jusqu’à une heure au moment de la préparation du rapport. Elles peuvent changer.'
				: 'Predictions cover up to one hour when the report is prepared. They may change.',
		);
	});
	it('states on time once when the reported delay is exactly zero', () => {
		const { container } = render(TripDetail, { props: { id: 'tEmpty' }, context });
		const verdict = container.querySelector('.trip-verdict')!;
		expect(within(verdict as HTMLElement).getAllByText(tripCopy[locale].onTime)).toHaveLength(1);
		expect(verdict.querySelector('.trip-verdict-delay')).toBeNull();
		expect(container.textContent).not.toMatch(/\/v1|never invented|jamais inventé/);
	});

	it.each([
		['on_time', 1, '1 min late', '1 min en retard', 'on-time'],
		['early', -2, '2 min early', '2 min en avance', 'early'],
		['severe', 4, '4 min late', '4 min en retard', 'severe'],
		['unknown', 4, '4 min late', '4 min en retard', 'none'],
		['unknown', 0, 'On time', "À l'heure", 'none'],
		['late', 0, 'On time', "À l'heure", 'late'],
	] as const)(
		'preserves status %s and independently reported delay %s',
		(status, delay, en, fr, tone) => {
			tripsData = {
				...TRIPS_FILE,
				trips: { probe: { status, delay_min: delay, route: '24', stops: [] } },
			} as TripsFile;
			const { container } = render(TripDetail, { props: { id: 'probe' }, context });
			const verdict = container.querySelector('.trip-verdict')!;
			expect(verdict.querySelector('.trip-status-label')).toHaveTextContent(
				tripCopy[locale].status[status],
			);
			expect(verdict.querySelector('.trip-verdict-delay')).toHaveTextContent(
				locale === 'fr' ? fr : en,
			);
			expect(verdict.querySelector('.trip-verdict-delay')).toHaveAttribute('data-tone', tone);
		},
	);

	it.each([null, undefined])(
		'retains missing-delay absence beside known on-time status: %s',
		(delay) => {
			tripsData = {
				...TRIPS_FILE,
				trips: { probe: { status: 'on_time', delay_min: delay, route: '24', stops: [] } },
			} as TripsFile;
			const { container } = render(TripDetail, { props: { id: 'probe' }, context });
			const verdict = container.querySelector('.trip-verdict')!;
			expect(verdict.querySelector('.trip-status-label')).toHaveTextContent(
				tripCopy[locale].status.on_time,
			);
			expect(verdict.querySelector('[data-slot="absent-value"]')).toBeInTheDocument();
			expect(verdict.querySelector('.trip-verdict-delay')).toBeNull();
		},
	);
});

describe('TripDetail: a broadcasting trip', () => {
	it('renders the trip heading, route link, status and current delay', () => {
		render(TripDetail, { props: { id: 't161' } });

		expect(screen.getByRole('heading', { name: 'Trip t161' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'View line 161' })).toHaveAttribute(
			'href',
			'/lines/161',
		);
		expect(screen.getByText('Late')).toBeInTheDocument();
		expect(screen.getAllByText('4 min late').length).toBeGreaterThanOrEqual(1);
	});

	it('renders the wayfinding breadcrumb (Home > Trip {id}) with the leaf as current', () => {
		render(TripDetail, { props: { id: 't161' } });

		const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
		expect(nav).toBeInTheDocument();
		expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
		const leaf = within(nav).getByText('Trip t161');
		expect(leaf).toHaveAttribute('aria-current', 'page');
		expect(within(nav).queryByRole('link', { name: 'Trip t161' })).toBeNull();
	});

	it('anchors the FreshnessStamp age to the SERVER clock (serverNow), not Date.now()', () => {
		render(TripDetail, { props: { id: 't161' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(within(chip).getByText('5 minutes ago')).toBeInTheDocument();
		expect(chip.querySelector('time')).toHaveAttribute('datetime', '2026-06-15T12:00:00Z');
	});

	it('frames each reported ETA as a prediction with an honest delay basis', () => {
		render(TripDetail, { props: { id: 't161' } });

		const stops = screen.getByRole('list', { name: 'Reported predictions for this trip' });
		expect(within(stops).getByRole('link', { name: 'View stop sA' })).toHaveAttribute(
			'href',
			'/stop/sA',
		);
		expect(within(stops).getAllByText('Prediction').length).toBe(2);
	});

	it('shows the delay basis when present and the styled honest-absence chip when null, never 0', () => {
		render(TripDetail, { props: { id: 't161' } });

		const stops = screen.getByRole('list', { name: 'Reported predictions for this trip' });
		expect(within(stops).getAllByText('4 min late').length).toBeGreaterThanOrEqual(1);
		const absent = within(stops).getByText('not reported in the live feed');
		expect(absent.closest('[data-slot="absent-value"]')).not.toBeNull();
		expect(within(stops).queryByText('0 min late')).not.toBeInTheDocument();
	});

	it('renders the styled honest-absence chip when a broadcasting trip omits route + delay', () => {
		render(TripDetail, { props: { id: 'tBlank' } });
		expect(screen.getByRole('heading', { name: 'Trip tBlank' })).toBeInTheDocument();
		const chips = screen.getAllByText('not reported in the live feed');
		expect(chips.length).toBe(2);
		for (const chip of chips) {
			expect(chip.closest('[data-slot="absent-value"]')).not.toBeNull();
		}
		expect(screen.queryByText('No line reported')).not.toBeInTheDocument();
	});

	it('renders an honest note when a broadcasting trip reports no predictions', () => {
		render(TripDetail, { props: { id: 'tEmpty' } });

		const empty = screen.getByTestId('trip-no-stops');
		expect(empty).toBeInTheDocument();
		expect(empty).toHaveAttribute('data-component', 'state-notice');
		expect(empty).toHaveAttribute('data-presentation', 'silo');
		expect(
			screen.queryByRole('list', { name: 'Reported predictions for this trip' }),
		).not.toBeInTheDocument();
	});
});

describe('TripDetail: stand-down honesty', () => {
	it('stands down when the trip id is absent from the retained report', () => {
		render(TripDetail, { props: { id: 'tGhost' } });

		expect(screen.getByTestId('trip-standdown')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Trip not in this report' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Trip tGhost' })).not.toBeInTheDocument();
	});

	it('stands down when no report has loaded', () => {
		tripsData = null;
		render(TripDetail, { props: { id: 't161' } });
		expect(screen.queryByRole('heading', { name: 'Trip t161' })).not.toBeInTheDocument();
		expect(screen.queryByTestId('trip-standdown')).not.toBeInTheDocument();
	});
});

describe.each(['en', 'fr'] as const)('TripDetail report scope in %s', (locale) => {
	const context = new Map([[Symbol.for('transit.i18n.locale'), () => locale]]);
	it('counts prediction rows and names the last reported stop without inferring a terminal', () => {
		const { container } = render(TripDetail, { props: { id: 't161' }, context });
		expect(container.querySelector('.trip-last-stop-name')).toHaveTextContent('sB');
		expect(container.querySelector('.trip-prediction-count')).toHaveTextContent(
			locale === 'fr' ? '2 prédictions communiquées' : '2 predictions reported',
		);
		expect(container.textContent).toContain(
			locale === 'fr' ? 'Dernier arrêt communiqué' : 'Last reported stop',
		);
		expect(container.textContent).not.toMatch(/Destination|stops remaining|arrêts restants/);
	});
	it.each([false, true])('retains report-specific absence and timestamp when stale=%s', (stale) => {
		reportStale = stale;
		render(TripDetail, { props: { id: 'tGhost' }, context });
		const stamp = document.querySelector('[data-slot="freshness-stamp"]')!;
		expect(stamp).toHaveAttribute('data-stale', String(stale));
		expect(stamp.querySelector('time')).toHaveAttribute('datetime', TRIPS_FILE.generated_utc);
		expect(screen.queryByTestId('trip-report-notice') !== null).toBe(stale);
	});
	it('warns on failed refresh without classifying a recent retained report as stale', () => {
		reportFailures = 1;
		render(TripDetail, { props: { id: 't161' }, context });
		const stamp = document.querySelector('[data-slot="freshness-stamp"]')!;
		expect(stamp).toHaveAttribute('data-degraded', 'true');
		expect(stamp).toHaveAttribute('data-stale', 'false');
		expect(screen.getByTestId('trip-report-notice')).toHaveTextContent(
			locale === 'fr' ? 'Actualisation indisponible' : 'Refresh unavailable',
		);
		expect(document.querySelectorAll('.trip-stop-link')).toHaveLength(2);
	});
});
