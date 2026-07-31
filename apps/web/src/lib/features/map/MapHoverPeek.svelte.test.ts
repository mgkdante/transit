import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
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
};
const stop: MapHoverPeekModel = {
	kind: 'stop',
	id: 'stop-2',
	title: 'Sherbrooke / Saint-Denis',
	nameAbsent: false,
	code: '202',
	vehicleCount: 2,
};

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
		// S5-387 B1: the AbsentValue pill branch (delay unknown) is the shape
		// whose wrapped notice clamped into an ellipse - it stays inert AND
		// styled (the radius scope-override lives in the component).
		['vehicle-delay-unknown', { ...vehicleFresh, delayMin: null }],
		['route-populated', route],
		['stop-populated', stop],
	])('keeps the %s branch inert and non-live', (_name, peek) => {
		const { container } = render(MapHoverPeek, { props: { peek, locale: 'en' } });
		expectInert(container);
	});

	it('scopes the AbsentValue surface radius inside the narrow peek grid', () => {
		const { container } = render(MapHoverPeek, {
			props: { peek: { ...vehicleFresh, delayMin: null }, locale: 'en' },
		});
		// the scoped rule must reach the node that owns border-radius
		expect(
			container.querySelectorAll("[data-slot='absent-value'] [data-part='surface']"),
		).toHaveLength(1);
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapHoverPeek.svelte'),
			'utf8',
		);
		expect(source).toMatch(/\[data-slot='absent-value'\] \[data-part='surface'\]/u);
		expect(source).toMatch(/dl \{[^}]*gap: 0\.625rem 0\.875rem;[^}]*\}/u);
	});

	it('renders the vehicle keep table and drops trip, alerts, actions, and links', () => {
		const { container } = render(MapHoverPeek, { props: { peek: vehicleStale, locale: 'en' } });

		expect(container).toHaveTextContent('Route 24');
		expect(container).toHaveTextContent('bus-24');
		expect(container).toHaveTextContent('Bus');
		expect(container).toHaveTextContent('Late');
		expect(container).toHaveTextContent('Standing');
		expect(container).toHaveTextContent('4 min late');
		expect(container).toHaveTextContent('Sherbrooke / Saint-Denis');
		expect(container).toHaveTextContent('Not reporting GPS');
		expect(container).toHaveTextContent('3 min');
		expect(container).not.toHaveTextContent('trip-secret');
		expect(container).not.toHaveTextContent('Alerts');
		expectInert(container);
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
		expect(definitionValue(container, 'Delay')).toHaveTextContent('No live data');
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
		expect(definitionValue(container, 'Delay')).toHaveTextContent(/not reporting/i);
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
		expect(definitionValue(container, 'Delay')).toHaveTextContent(/not reported/i);
	});

	it('renders route long name, type, and visible-bus count without direction', () => {
		const { container } = render(MapHoverPeek, { props: { peek: route, locale: 'en' } });

		expect(container).toHaveTextContent('Route 24');
		expect(container).toHaveTextContent('Sherbrooke');
		expect(container).toHaveTextContent('Bus');
		expect(container).toHaveTextContent('2 buses visible');
		expect(container).not.toHaveTextContent('Direction');
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

	it('renders stop code and vehicles-heading count while omitting departures entirely', () => {
		const { container } = render(MapHoverPeek, { props: { peek: stop, locale: 'en' } });

		expect(container).toHaveTextContent('Sherbrooke / Saint-Denis');
		expect(container).toHaveTextContent('202');
		expect(container).toHaveTextContent('2 buses heading here');
		expect(container.textContent?.toLowerCase()).not.toContain('departure');
	});

	it('structurally drops the former alerts states and the false departures-unavailable path', () => {
		const modelSource = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/mapHoverPeek.ts'),
			'utf8',
		);
		const componentSource = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapHoverPeek.svelte'),
			'utf8',
		);

		expect(modelSource).not.toContain('alerts');
		expect(componentSource).not.toContain('alerts');
		expect(componentSource).not.toContain('departuresUnavailable');
	});
});
