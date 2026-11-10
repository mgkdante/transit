const testProvider = vi.hoisted(() => ({ id: 'stm' }));
vi.mock('#lib/site/absence.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/site/absence.ts')>()),
	readLiveAbsenceContext: () => () => ({ providerId: testProvider.id }),
}));
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_LABELS } from '#lib/v1/enumLabels.ts';
import type { Alert } from '#lib/v1/schemas/index.ts';
import MapHoverPeek from './MapHoverPeek.svelte';
import type { MapHoverPeek as MapHoverPeekModel } from './mapHoverPeek';

const vehicleStale: MapHoverPeekModel = {
	kind: 'vehicle',
	id: 'bus-24',
	title: 'bus-24',
	route: { id: '24', longName: 'Sherbrooke', type: 3, labelInferred: false },
	status: 'late',
	delayMin: 4,
	occupancy: 'standing',
	nextStop: { id: 'stop-2', name: 'Sherbrooke / Saint-Denis', nameAbsent: false },
	nextStopAbsence: 'not-in-schedule',
	notReportingAgeS: 180,
	tripId: 'trip-secret',
	alerts: null,
};
const vehicleFresh: MapHoverPeekModel = { ...vehicleStale, notReportingAgeS: null };
const route: MapHoverPeekModel = {
	kind: 'route',
	id: '24',
	title: '24',
	longName: 'Sherbrooke',
	type: 3,
	labelInferred: false,
	visibleVehicleCount: 2,
	directionLabel: null,
	alerts: null,
};
const stop: MapHoverPeekModel = {
	kind: 'stop',
	id: 'stop-2',
	title: 'Sherbrooke / Saint-Denis',
	nameAbsent: false,
	code: '202',
	vehicleCount: 2,
	departureCount: 3,
	alerts: null,
};

const alert = {
	id: 'alert-24',
	severity: 'high',
	header_key: 'Detour on route 24',
	description_en: '<p>Route 24 is diverted.</p>',
	routes: ['24'],
	stops: [],
} as Alert;

afterEach(() => cleanup());

function expectInert(container: HTMLElement): void {
	expect(container.querySelector('[aria-live]')).toBeNull();
	expect(container.querySelector('[role="status"]')).toBeNull();
	expect(container.querySelector('[role="alert"]')).toBeNull();
	expect(
		container.querySelector(
			'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
		),
	).toBeNull();
}

function definitionValue(container: HTMLElement, term: string): HTMLElement {
	const matchingTerm = [...container.querySelectorAll('dt')].find(
		(candidate) => candidate.textContent === term,
	);
	const value = matchingTerm?.nextElementSibling;
	if (!(value instanceof HTMLElement)) {
		throw new Error(`expected a definition value for ${term}`);
	}
	return value;
}

describe('MapHoverPeek', () => {
	it.each([
		['vehicle-stale', vehicleStale],
		['vehicle-fresh', vehicleFresh],
		['vehicle-delay-unknown', { ...vehicleFresh, delayMin: null }],
		['route-populated', route],
		['stop-populated', stop],
	])('keeps the %s branch inert and non-live', (_name, peek) => {
		const { container } = render(MapHoverPeek, { props: { peek, locale: 'en' } });
		expectInert(container);
	});

	it('sums a vehicle up as the panel header, route tag, status, next stop and one alert line', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...vehicleStale, alerts: [alert] }, locale: 'en' },
		});

		expect(container.querySelector('.peek-kind')).toHaveTextContent('Vehicle');
		expect(container.querySelector('h2')).toHaveTextContent('bus-24');
		const lede = container.querySelector('[data-slot="peek-lede"]')!;
		expect(lede).toHaveTextContent('Route 24');
		expect(lede).toHaveTextContent('Sherbrooke');
		expect(container).toHaveTextContent('No recent position');
		expect(container).toHaveTextContent('3 min');
		expect(definitionValue(container, 'Status')).toHaveTextContent('Late');
		expect(definitionValue(container, 'Status')).toHaveTextContent('+4 min');
		expect(definitionValue(container, 'Next stop')).toHaveTextContent('Sherbrooke / Saint-Denis');
		expect([...container.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
			'Status',
			'Next stop',
		]);
		// Trip and crowding stay in the panel; the glance does not repeat them.
		expect(container).not.toHaveTextContent('trip-secret');
		expect(container).not.toHaveTextContent('Standing');
		expect(container.querySelector('section[aria-label="Alerts"]')).toHaveTextContent(
			'Route 24 is diverted.',
		);
		expectInert(container);
	});

	it('shows at most one alert line and counts the rest', () => {
		const second = { ...alert, id: 'alert-24-b', severity: 'critical' } as Alert;
		const third = { ...alert, id: 'alert-24-c' } as Alert;
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...vehicleFresh, alerts: [second, alert, third] }, locale: 'fr' },
		});

		const lines = container.querySelectorAll('.map-peek-alert');
		expect(lines).toHaveLength(1);
		expect(lines[0]).toHaveAttribute('data-severity', 'critical');
		expect(lines[0].querySelector('.map-peek-alerts-more')).toHaveTextContent('+2 de plus');
		expect(container.querySelector('.map-alerts h3')).toBeNull();
		expectInert(container);
	});

	it.each([
		{ delayMin: 0, status: 'on_time', want: 'On-time', absence: false },
		{ delayMin: 4, status: 'late', want: '▲ Late · +4 min', absence: false },
		{
			delayMin: null,
			status: 'unknown',
			want: 'not reported in the live feed',
			absence: true,
		},
	] as const)(
		'merges vehicle delay $delayMin into the passive status fact',
		({ delayMin, status, want, absence }) => {
			const { container } = render(MapHoverPeek, {
				props: { peek: { ...vehicleFresh, delayMin, status }, locale: 'en' },
			});
			const statusValue = definitionValue(container, 'Status');

			expect(statusValue).toHaveTextContent(want);
			expect(statusValue.querySelector('[data-slot="absent-value"]') != null).toBe(absence);
			if (delayMin == null) expect(statusValue.textContent?.match(/Unknown/g)).toHaveLength(1);
			expect([...container.querySelectorAll('dt')].map((term) => term.textContent)).not.toContain(
				'Delay',
			);
			expectInert(container);
		},
	);

	it('keeps unavailable and empty alert rails out of the transient peek', () => {
		for (const alerts of [null, []] as const) {
			const { container, unmount } = render(MapHoverPeek, {
				props: { peek: { ...vehicleFresh, alerts }, locale: 'en' },
			});
			expect(container).not.toHaveTextContent('Alerts');
			expect(container).not.toHaveTextContent('Alert data unavailable');
			expect(container).not.toHaveTextContent('No alerts attached');
			expect(container.querySelector('.map-alerts')).toBeNull();
			unmount();
		}
	});

	it.each([
		['stm', 1, 'en'],
		['stm', 1, 'fr'],
		['octranspo', 0, 'en'],
		['octranspo', 0, 'fr'],
	] as const)('explains unpublished live data for %s in %s / %s', (provider, type, locale) => {
		testProvider.id = provider;
		const why = locale === 'en' ? 'No live data' : 'Aucune donnée en direct';
		const freshMetro: MapHoverPeekModel = {
			...vehicleFresh,
			route: { ...vehicleFresh.route!, type },
			delayMin: null,
			occupancy: null,
		};
		const { container } = render(MapHoverPeek, {
			props: { peek: freshMetro, locale },
		});

		expect(definitionValue(container, locale === 'en' ? 'Status' : 'Statut')).toHaveTextContent(
			why,
		);
		expect(container).not.toHaveTextContent('Not reported');
	});

	it('renders stale null fields as not reporting', () => {
		const staleNulls: MapHoverPeekModel = {
			...vehicleStale,
			delayMin: null,
			occupancy: null,
		};
		const { container } = render(MapHoverPeek, {
			props: { peek: staleNulls, locale: 'en' },
		});

		expect(definitionValue(container, 'Status')).toHaveTextContent(/not reporting/i);
	});

	it('renders fresh non-metro null fields as not reported', () => {
		const freshBusNulls: MapHoverPeekModel = {
			...vehicleFresh,
			delayMin: null,
			occupancy: null,
		};
		const { container } = render(MapHoverPeek, {
			props: { peek: freshBusNulls, locale: 'en' },
		});

		expect(definitionValue(container, 'Status')).toHaveTextContent(/not reported/i);
	});

	it('renders route long name, direction, and visible-vehicle count', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...route, directionLabel: 'East · toward Frontenac' }, locale: 'en' },
		});

		expect(container.querySelector('.peek-kind')).toHaveTextContent('Route');
		expect(container.querySelector('h2')).toHaveTextContent('24');
		expect(container.querySelector('[data-slot="peek-lede"]')).toHaveTextContent('Sherbrooke');
		expect(definitionValue(container, 'Live vehicles')).toHaveTextContent('2 vehicles visible');
		expect(definitionValue(container, 'Direction')).toHaveTextContent('East · toward Frontenac');
		expectInert(container);
	});

	it('marks inferred vehicle route copy and labels an unnamed stop honestly', () => {
		const inferredVehicle: MapHoverPeekModel = {
			...vehicleFresh,
			route: { id: '1', longName: 'Route 1', type: 1, labelInferred: true },
		};
		const unnamedStop: MapHoverPeekModel = {
			kind: 'stop',
			id: 'stop-missing',
			title: 'Stop stop-missing',
			nameAbsent: true,
			code: null,
			vehicleCount: 0,
			departureCount: null,
			alerts: null,
		};

		const vehicleRender = render(MapHoverPeek, {
			props: { peek: inferredVehicle, locale: 'en' },
		});
		expect(vehicleRender.container).toHaveTextContent('Estimated');
		vehicleRender.unmount();

		const stopRender = render(MapHoverPeek, { props: { peek: unnamedStop, locale: 'en' } });
		expect(stopRender.container).toHaveTextContent('Stop stop-missing (name unavailable)');
	});

	it('labels an in-schedule next stop with an unnamed catalogue entry honestly', () => {
		const unnamedNextStop: MapHoverPeekModel = {
			...vehicleFresh,
			nextStop: { id: 'stop-unnamed', name: 'stop-unnamed', nameAbsent: true },
			nextStopAbsence: 'not-in-schedule',
		};

		const { container } = render(MapHoverPeek, {
			props: { peek: unnamedNextStop, locale: 'en' },
		});

		expect(container).toHaveTextContent('Stop stop-unnamed (name unavailable)');
		expect(container).not.toHaveTextContent('Next stop unknown');
	});

	it.each([
		['en', 'Stop code', 'Approaching', '2 vehicles', 'Departures', '3 departures'],
		['fr', "Code d'arrêt", 'En approche', '2 véhicules', 'Départs', '3 départs'],
	] as const)(
		'gives a stop its code, approaching vehicles and departures as separate rows in %s',
		(locale, codeTerm, approachingTerm, vehicles, departuresTerm, departures) => {
			const { container } = render(MapHoverPeek, { props: { peek: stop, locale } });

			expect(container.querySelector('h2')).toHaveTextContent('Sherbrooke / Saint-Denis');
			expect(definitionValue(container, codeTerm)).toHaveTextContent('202');
			expect(definitionValue(container, approachingTerm)).toHaveTextContent(vehicles);
			expect(definitionValue(container, departuresTerm)).toHaveTextContent(departures);
			expectInert(container);
		},
	);

	it('renders unavailable departures honestly instead of fabricating zero', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...stop, departureCount: null }, locale: 'en' },
		});

		expect(container).toHaveTextContent('Live departures unavailable');
		expect(container).not.toHaveTextContent('0 departures');
		expectInert(container);
	});
});

describe.each(['en', 'fr'] as const)('MapHoverPeek published status in %s', (locale) => {
	it.each([
		['on_time', 1, '+1 min'],
		['late', 0, '0 min'],
		['early', -2, '−2 min'],
		['severe', 4, '+4 min'],
		['unknown', 0, '0 min'],
		['on_time', null, null],
		['unknown', null, null],
	] as const)('%s with delay %s', (status, delayMin, measurement) => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...vehicleFresh, status, delayMin }, locale },
		});
		const fact = definitionValue(container, locale === 'fr' ? 'Statut' : 'Status');
		expect(fact).toHaveTextContent(STATUS_LABELS[locale][status]);
		const mark = fact.querySelector('.peek-status');
		if (measurement || status !== 'unknown') expect(mark).toHaveAttribute('data-status', status);
		const reading = fact.querySelector('.map-peek-delay')!;
		if (measurement) expect(reading).toHaveTextContent(measurement);
		else expect(reading.querySelector('[data-slot="absent-value"]')).toBeInTheDocument();
		expect(reading.textContent).not.toMatch(/late|early|On time|retard|avance|heure/);
		expectInert(container);
	});
});

it.each([
	['stm', 1, 'en'],
	['stm', 1, 'fr'],
	['octranspo', 0, 'en'],
	['octranspo', 0, 'fr'],
] as const)('explains an empty declared line for %s type %s in %s', (provider, type, locale) => {
	testProvider.id = provider;
	const peek: MapHoverPeekModel = { ...route, type, visibleVehicleCount: 0 };
	const { container } = render(MapHoverPeek, { props: { peek, locale } });
	expect(container).toHaveTextContent(locale === 'en' ? 'No live data' : 'Aucune donnée en direct');
});

it.each(['en', 'fr'] as const)(
	'labels an untripped vehicle without punctuality in %s',
	(locale) => {
		const view = render(MapHoverPeek, { peek: { ...vehicleFresh, tripId: null }, locale });
		const status = definitionValue(view.container, locale === 'en' ? 'Status' : 'Statut');
		expect(status).toHaveTextContent(locale === 'en' ? 'Out of service' : 'Hors service');
		expect(status).not.toHaveTextContent(STATUS_LABELS[locale].late);
		expect(status.querySelector('.map-peek-delay')).toBeNull();
	},
);
