import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Alert } from '$lib/v1/schemas';
import MapHoverPeek from './MapHoverPeek.svelte';
import type { MapHoverPeek as MapHoverPeekModel } from './mapHoverPeek';

const vehicleStale: MapHoverPeekModel = {
	kind: 'vehicle',
	id: 'bus-24',
	title: 'Route 24',
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
	title: 'Route 24',
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
		// The AbsentValue pill branch stays inert and uses the shared chassis.
		['vehicle-delay-unknown', { ...vehicleFresh, delayMin: null }],
		['route-populated', route],
		['stop-populated', stop],
	])('keeps the %s branch inert and non-live', (_name, peek) => {
		const { container } = render(MapHoverPeek, { props: { peek, locale: 'en' } });
		expectInert(container);
	});

	it('lets the shared absence chassis own presentation inside the narrow peek grid', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...vehicleFresh, delayMin: null }, locale: 'en' },
		});
		expect(
			container.querySelectorAll("[data-slot='absent-value'] [data-part='surface']"),
		).toHaveLength(1);
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapHoverPeek.svelte'),
			'utf8',
		);
		expect(source).not.toMatch(/\[data-slot='absent-value'\] \[data-part='surface'\]/u);
		expect(source).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/u);
		expect(source).toMatch(/dd \{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/u);
		expect(source).toMatch(/dl \{[^}]*gap: 0\.625rem 0\.875rem;[^}]*\}/u);
	});

	it('renders useful trip and alert truth without turning the peek into an interactive panel', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...vehicleStale, alerts: [alert] }, locale: 'en' },
		});

		expect(container).toHaveTextContent('Route 24');
		expect(container).toHaveTextContent('bus-24');
		expect(container).toHaveTextContent('Bus');
		expect(container).toHaveTextContent('Late');
		expect(container).toHaveTextContent('Standing');
		expect(container).toHaveTextContent('4 min late');
		expect(container).toHaveTextContent('Sherbrooke / Saint-Denis');
		expect(container).toHaveTextContent('No recent position');
		expect(container).toHaveTextContent('3 min');
		expect(definitionValue(container, 'Trip')).toHaveTextContent('trip-secret');
		expect(container).toHaveTextContent('Alerts');
		expect(container).toHaveTextContent('Route 24 is diverted.');
		expectInert(container);
	});

	it.each([
		{ delayMin: 0, status: 'on_time', want: 'On-time', absence: false },
		{ delayMin: 4, status: 'late', want: 'Late · 4 min late', absence: false },
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
			unmount();
		}
	});

	it('renders fresh metro null fields as no live data, never not reported', () => {
		const freshMetro: MapHoverPeekModel = {
			...vehicleFresh,
			route: { ...vehicleFresh.route!, type: 1 },
			delayMin: null,
			occupancy: null,
		};
		const { container } = render(MapHoverPeek, {
			props: { peek: freshMetro, locale: 'en' },
		});

		expect(definitionValue(container, 'Crowding')).toHaveTextContent('No live data');
		expect(definitionValue(container, 'Status')).toHaveTextContent('No live data');
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

		expect(definitionValue(container, 'Crowding')).toHaveTextContent(/not reporting/i);
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

		expect(definitionValue(container, 'Crowding')).toHaveTextContent(/not reported/i);
		expect(definitionValue(container, 'Status')).toHaveTextContent(/not reported/i);
	});

	it('renders route long name, type, direction, and visible-bus count', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...route, directionLabel: 'East · toward Frontenac' }, locale: 'en' },
		});

		expect(container).toHaveTextContent('Route 24');
		expect(container).toHaveTextContent('Sherbrooke');
		expect(container).toHaveTextContent('Bus');
		expect(container).toHaveTextContent('2 buses visible');
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

	it('renders stop code, vehicles-heading count, and loaded departure count', () => {
		const { container } = render(MapHoverPeek, { props: { peek: stop, locale: 'en' } });

		expect(container).toHaveTextContent('Sherbrooke / Saint-Denis');
		expect(container).toHaveTextContent('202');
		expect(container).toHaveTextContent('2 buses heading here');
		expect(container).toHaveTextContent('3 departures');
		expectInert(container);
	});

	it('renders unavailable departures honestly instead of fabricating zero', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...stop, departureCount: null }, locale: 'en' },
		});

		expect(container).toHaveTextContent('Live departures unavailable');
		expect(container).not.toHaveTextContent('0 departures');
		expectInert(container);
	});
});
