import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildLiveIndex } from '$lib/v1/live';
import type { Alert, IsoUtc, RouteFile, StopFile, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import MapSelectionDetail from './MapSelectionDetail.svelte';
import { resolveMapSelection } from './mapSelection';

const utc = (value: string) => value as IsoUtc;

const vehicles: Vehicle[] = [
	{
		id: 'veh-1',
		lat: 45.5,
		lon: -73.6,
		status: 'late',
		updated_utc: utc('2026-06-15T00:00:00Z'),
		route: '24',
		trip: 'trip-24-a',
		next_stop: 'stop-2',
		bearing: 90,
		delay_min: 4,
		occupancy: 'standing',
	},
	{
		id: 'veh-2',
		lat: 45.51,
		lon: -73.61,
		status: 'on_time',
		updated_utc: utc('2026-06-15T00:00:00Z'),
		route: '24',
		trip: 'trip-24-b',
		next_stop: 'stop-2',
		bearing: null,
		delay_min: 0,
		occupancy: 'many_seats',
	},
];
const stops: StopIndexEntry[] = [
	{ id: 'stop-1', name: 'Sherbrooke / Saint-Denis', code: '52618', lat: 45.51, lon: -73.57 },
	{ id: 'stop-2', name: 'Mont-Royal / Saint-Laurent', code: '53110', lat: 45.52, lon: -73.58 },
	{ id: 'stop-3', name: 'Van Horne / Rockland', code: '57191', lat: 45.53, lon: -73.59 },
];
const alerts: Alert[] = [
	{
		id: 'route-alert',
		severity: 'high',
		header_key: 'Detour on route 24',
		header_text: 'Detour on route 24',
		routes: ['24'],
		stops: [],
	},
	{
		id: 'stop-alert',
		severity: 'watch',
		header_key: 'Stop moved',
		header_text: 'Stop moved',
		routes: [],
		stops: ['stop-1', 'stop-2'],
	},
];
const routes: RouteFile[] = [
	{
		generated_utc: utc('2026-06-15T00:00:00Z'),
		id: '24',
		long: 'Sherbrooke',
		directions: [
			{
				dir: 0,
				headsign: 'East',
				shape: null,
				stops: [
					{ id: 'stop-1', seq: 1, name: 'Sherbrooke / Saint-Denis' },
					{ id: 'stop-2', seq: 2, name: 'Mont-Royal / Saint-Laurent' },
					{ id: 'stop-3', seq: 3, name: 'Van Horne / Rockland' },
				],
			},
		],
	},
];
const stopFiles: StopFile[] = [
	{
		generated_utc: utc('2026-06-15T00:00:00Z'),
		id: 'stop-1',
		name: 'Sherbrooke / Saint-Denis',
		lat: 45.51,
		lon: -73.57,
		code: '52618',
		routes_served: ['24', '55'],
		scheduled: [
			{ route: '24', headsign: 'East', times: ['08:00', '12:00', '23:50'] },
			{ route: '55', headsign: 'North', times: ['10:00', '20:00'] },
		],
	},
];
const index = buildLiveIndex({
	vehicles: { generated_utc: utc('2026-06-15T00:00:00Z'), vehicles },
	trips: {
		generated_utc: utc('2026-06-15T00:00:00Z'),
		trips: {
			'trip-24-a': {
				status: 'late',
				route: '24',
				delay_min: 4,
				stops: [
					{ stop: 'stop-2', eta_utc: utc('2026-06-15T00:06:00Z'), delay_min: 4 },
					{ stop: 'stop-3', eta_utc: utc('2026-06-15T00:16:00Z'), delay_min: 5 },
				],
			},
		},
	},
	stopDepartures: {
		generated_utc: utc('2026-06-15T00:00:00Z'),
		stops: {
			'stop-1': [
				{ route: '24', trip: 'trip-24-a', eta_utc: utc('2026-06-15T00:06:00Z'), delay_min: 4 },
				{ route: '55', trip: 'trip-55-a', eta_utc: utc('2026-06-15T00:16:00Z'), delay_min: 0 },
			],
		},
	},
});

describe('MapSelectionDetail', () => {
	it('renders a vehicle detail with status, crowding, next stop, and alerts', async () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const onselect = vi.fn();
		const onfilter = vi.fn();
		const onalertselect = vi.fn();
		const { getAllByRole, getAllByText, getByRole, getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', onselect, onfilter, onalertselect },
		});

		expect(getAllByText('Bus').length).toBeGreaterThan(0);
		expect(getByRole('button', { name: 'Select bus veh-1' })).toBeInTheDocument();
		expect(getByText('Late')).toBeInTheDocument();
		expect(getByText('Standing')).toBeInTheDocument();
		expect(getByText('Past stops')).toBeInTheDocument();
		expect(getByText('Next stops')).toBeInTheDocument();
		expect(getByText('Sherbrooke / Saint-Denis')).toBeInTheDocument();
		expect(getAllByText('Mont-Royal / Saint-Laurent').length).toBeGreaterThan(0);
		expect(getByText('Van Horne / Rockland')).toBeInTheDocument();
		expect(getByText('Detour on route 24')).toBeInTheDocument();
		expect(getByText('Stop moved')).toBeInTheDocument();

		if (detail?.kind !== 'vehicle') throw new Error('expected vehicle detail');
		await fireEvent.click(getByRole('button', { name: 'Select route 24' }));
		expect(onselect).toHaveBeenCalledWith({
			kind: 'route',
			id: '24',
			direction: 0,
			variantKey: detail.routeDirectionVariant?.key,
		});

		await fireEvent.click(getByRole('button', { name: 'Select bus veh-1' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-1' });

		await fireEvent.click(getByRole('button', { name: 'Filter status Late' }));
		expect(onfilter).toHaveBeenCalledWith({ kind: 'status', value: 'late' });

		await fireEvent.click(getByRole('button', { name: 'Filter crowding Standing' }));
		expect(onfilter).toHaveBeenCalledWith({ kind: 'occupancy', value: 'standing' });

		await fireEvent.click(getByRole('button', { name: 'Filter trip trip-24-a' }));
		expect(onfilter).toHaveBeenCalledWith({ kind: 'trip', value: 'trip-24-a' });

		await fireEvent.click(
			getAllByRole('button', { name: 'Select stop Mont-Royal / Saint-Laurent' })[0],
		);
		expect(onselect).toHaveBeenCalledWith({ kind: 'stop', id: 'stop-2' });

		await fireEvent.click(getByRole('button', { name: 'Select alert Detour on route 24' }));
		expect(onalertselect).toHaveBeenCalledWith(alerts[0]);
	});

	it('renders a per-bus not-reporting GPS note when the vehicle fix is stale', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { getByText, getByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: { ageS: 180 } },
		});

		// The honest caution note shows, carries a relative age, and is role=status.
		const note = getByRole('status');
		expect(note).toHaveTextContent('Not reporting GPS');
		expect(note).toHaveTextContent('3 min');
		// No em-dash in the copy (brand rule) — a middot separates the two halves.
		expect(note.textContent).not.toContain('—');
		expect(getByText(/last updated position 3 min ago/)).toBeInTheDocument();
	});

	it('renders the not-reporting age in seconds for a recently-silent bus', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: { ageS: 45 } },
		});

		expect(getByText(/last updated position 45 s ago/)).toBeInTheDocument();
	});

	it('renders the not-reporting note in French', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { getByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'fr', notReporting: { ageS: 180 } },
		});

		const note = getByRole('status');
		expect(note).toHaveTextContent('Pas de signal GPS');
		expect(note).toHaveTextContent('dernière position il y a 3 min');
	});

	it('hides the not-reporting note when notReporting is null', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { queryByText, queryByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: null },
		});

		expect(queryByText(/Not reporting GPS/)).not.toBeInTheDocument();
		expect(queryByRole('status')).not.toBeInTheDocument();
	});

	it('renders a stop detail with code, departures, inbound vehicles, and alerts', async () => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{
				index,
				stops,
				alerts,
				stopFiles,
				now: new Date('2026-06-15T16:30:00Z'),
			},
		);
		const onselect = vi.fn();
		const onfilter = vi.fn();
		const { getAllByRole, getAllByText, getByRole, getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', onselect, onfilter },
		});

		expect(getByText('Stop')).toBeInTheDocument();
		expect(getByText('52618')).toBeInTheDocument();
		expect(getByText('2 departures')).toBeInTheDocument();
		expect(getByText('0 buses heading here')).toBeInTheDocument();
		expect(getAllByText('Route 24').length).toBeGreaterThan(0);
		expect(getAllByText('Past times').length).toBeGreaterThan(0);
		expect(getAllByText('Next times').length).toBeGreaterThan(0);
		expect(getByText('08:00')).toBeInTheDocument();
		expect(getByText('23:50')).toBeInTheDocument();
		expect(getByText('Stop moved')).toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Select route 24' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'route', id: '24' });

		await fireEvent.click(getAllByRole('button', { name: 'Filter trip trip-24-a' })[0]);
		expect(onfilter).toHaveBeenCalledWith({ kind: 'trip', value: 'trip-24-a' });
	});

	it('renders inbound stop vehicles as clickable bus rows', async () => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-2' },
			{
				index,
				stops,
				alerts,
				stopFiles,
				now: new Date('2026-06-15T16:30:00Z'),
			},
		);
		const onselect = vi.fn();
		const { getByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', onselect },
		});

		await fireEvent.click(getByRole('button', { name: 'Select bus veh-1' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-1' });

		await fireEvent.click(getByRole('button', { name: 'Select bus veh-2' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-2' });
	});

	it('renders a route detail with direction, live buses, and alerts', async () => {
		const detail = resolveMapSelection(
			{ kind: 'route', id: '24', direction: 0 },
			{ index, stops, alerts, routes },
		);
		const onselect = vi.fn();
		const { getAllByText, getByRole, getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', onselect },
		});

		expect(getAllByText('Route 24').length).toBeGreaterThan(0);
		expect(getByText('24')).toBeInTheDocument();
		expect(getByText('Sherbrooke')).toBeInTheDocument();
		expect(getAllByText('East').length).toBeGreaterThan(0);
		expect(getByText('2 buses visible')).toBeInTheDocument();
		expect(getByText('Stops')).toBeInTheDocument();
		expect(getByText('Sherbrooke / Saint-Denis')).toBeInTheDocument();
		expect(getByText('Mont-Royal / Saint-Laurent')).toBeInTheDocument();
		expect(getByText('Van Horne / Rockland')).toBeInTheDocument();
		expect(getByText('Detour on route 24')).toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Select stop Van Horne / Rockland' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'stop', id: 'stop-3' });

		await fireEvent.click(getByRole('button', { name: 'Select bus veh-1' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-1' });
	});

	it('renders a null delay as the honest absence (unknown + why), never "No delay" or "On time"', () => {
		// A vehicle the feed reports with a null delay — must NOT read as on-time.
		const nullDelayIndex = buildLiveIndex({
			vehicles: {
				generated_utc: utc('2026-06-15T00:00:00Z'),
				vehicles: [
					{
						id: 'veh-nd',
						lat: 45.5,
						lon: -73.6,
						status: 'unknown',
						updated_utc: utc('2026-06-15T00:00:00Z'),
						route: '24',
						trip: null,
						next_stop: 'stop-2',
						bearing: null,
						delay_min: null,
						occupancy: null,
					},
				],
			},
			trips: { generated_utc: utc('2026-06-15T00:00:00Z'), trips: {} },
			stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
		});
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-nd' },
			{ index: nullDelayIndex, stops, alerts, routes },
		);
		const { container, queryByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en' },
		});

		// The delay cell is the honest absence primitive (calm "unknown" tone), not a tag.
		const absent = container.querySelector('[data-slot="absent-value"][data-tone="unknown"]');
		expect(absent).not.toBeNull();
		// The reason: the feed simply omitted it (not-reported), not on-time, not "No delay".
		expect(absent!.textContent).toContain('not reported in the live feed');
		expect(queryByText('On time')).not.toBeInTheDocument();
		expect(queryByText('No delay')).not.toBeInTheDocument();
	});

	it('explains a GPS-stale focused vehicle delay as not-reporting (stale), not on-time', () => {
		const nullDelayIndex = buildLiveIndex({
			vehicles: {
				generated_utc: utc('2026-06-15T00:00:00Z'),
				vehicles: [
					{
						id: 'veh-stale',
						lat: 45.5,
						lon: -73.6,
						status: 'unknown',
						updated_utc: utc('2026-06-15T00:00:00Z'),
						route: '24',
						trip: null,
						next_stop: 'stop-2',
						bearing: null,
						delay_min: null,
						occupancy: null,
					},
				],
			},
			trips: { generated_utc: utc('2026-06-15T00:00:00Z'), trips: {} },
			stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
		});
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-stale' },
			{ index: nullDelayIndex, stops, alerts, routes },
		);
		const { container } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: { ageS: 200 } },
		});

		// The delay-grid cell (first absent-value in the detail grid) reads stale.
		const absent = container.querySelector('.map-detail-grid [data-slot="absent-value"]');
		expect(absent).not.toBeNull();
		expect(absent!.textContent).toContain('this vehicle is not reporting');
	});

	it('explains a metro vehicle null delay as metro-no-realtime ("No live data"), never not-reported or on-time', () => {
		// A metro route (route_type 1) carries NO realtime in the feed by design, so a
		// null delay is honestly "no live data" (metro-no-realtime), not "not reported".
		const metroIndex = buildLiveIndex({
			vehicles: {
				generated_utc: utc('2026-06-15T00:00:00Z'),
				vehicles: [
					{
						id: 'veh-metro',
						lat: 45.5,
						lon: -73.6,
						status: 'unknown',
						updated_utc: utc('2026-06-15T00:00:00Z'),
						route: 'metro-1',
						trip: null,
						next_stop: null,
						bearing: null,
						delay_min: null,
						occupancy: null,
					},
				],
			},
			trips: { generated_utc: utc('2026-06-15T00:00:00Z'), trips: {} },
			stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
		});
		const metroRoutes: RouteFile[] = [
			{
				generated_utc: utc('2026-06-15T00:00:00Z'),
				id: 'metro-1',
				long: 'Green Line',
				type: 1,
				directions: [],
			},
		];
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-metro' },
			{ index: metroIndex, stops, alerts, routes: metroRoutes },
		);
		const { container, queryByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en' },
		});

		// The delay-grid cell (first absent-value in the detail grid) reads metro-no-realtime.
		const absent = container.querySelector('.map-detail-grid [data-slot="absent-value"]');
		expect(absent).not.toBeNull();
		expect(absent!.textContent).toContain('live positions are not published here');
		expect(absent!.textContent).not.toContain('not reported');
		expect(queryByText('On time')).not.toBeInTheDocument();
	});

	it('renders an unresolved next_stop as the honest reason, never the raw stop id', () => {
		const unresolvedIndex = buildLiveIndex({
			vehicles: {
				generated_utc: utc('2026-06-15T00:00:00Z'),
				vehicles: [
					{
						id: 'veh-unres',
						lat: 45.5,
						lon: -73.6,
						status: 'late',
						updated_utc: utc('2026-06-15T00:00:00Z'),
						route: '24',
						trip: null,
						// A next-stop id that is NOT in the static stop index.
						next_stop: 'ghost-stop-999',
						bearing: null,
						delay_min: 2,
						occupancy: null,
					},
				],
			},
			trips: { generated_utc: utc('2026-06-15T00:00:00Z'), trips: {} },
			stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
		});
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-unres' },
			{ index: unresolvedIndex, stops, alerts, routes },
		);
		const { container, queryByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en' },
		});

		// The raw id never leaks; the layer says the next stop is unknown.
		expect(queryByText('ghost-stop-999')).not.toBeInTheDocument();
		const absent = container.querySelector('[data-slot="absent-value"][data-tone="unknown"]');
		expect(absent).not.toBeNull();
		expect(container.textContent).toContain('not in the schedule');
	});

	it('renders a null stop name as the labelled fallback, never the bare id', () => {
		// stop-2 (the next stop) is present but UNNAMED in this index — its name must
		// render the honest "Stop {id} (name unavailable)" fallback, never the id alone.
		const unnamedStops: StopIndexEntry[] = [
			{ id: 'stop-1', name: 'Sherbrooke / Saint-Denis', code: '52618', lat: 45.51, lon: -73.57 },
			{ id: 'stop-3', name: 'Van Horne / Rockland', code: '57191', lat: 45.53, lon: -73.59 },
		];
		const routesNoName: RouteFile[] = [
			{
				generated_utc: utc('2026-06-15T00:00:00Z'),
				id: '24',
				long: 'Sherbrooke',
				directions: [
					{
						dir: 0,
						headsign: 'East',
						shape: null,
						stops: [
							{ id: 'stop-1', seq: 1, name: 'Sherbrooke / Saint-Denis' },
							{ id: 'stop-2', seq: 2, name: null },
							{ id: 'stop-3', seq: 3, name: 'Van Horne / Rockland' },
						],
					},
				],
			},
		];
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops: unnamedStops, alerts, routes: routesNoName },
		);
		const { getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en' },
		});

		// The honest labelled fallback shows; the bare id alone is never rendered.
		expect(getByText('Stop stop-2 (name unavailable)')).toBeInTheDocument();
	});

	it('uses phone-first wrapping for dense detail rows and action buttons', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapSelectionDetail.svelte'),
			'utf-8',
		);

		expect(source).toMatch(
			/@media \(max-width: 42rem\)[\s\S]*\.map-detail-grid div\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/,
		);
		expect(source).toMatch(
			/@media \(max-width: 42rem\)[\s\S]*\.map-detail-grid dd\s*\{[\s\S]*white-space:\s*normal/,
		);
		expect(source).toMatch(
			/@media \(max-width: 42rem\)[\s\S]*\.map-inline-action\s*\{[\s\S]*white-space:\s*normal/,
		);
	});

	it('gives the Live arrivals a compact treatment at a narrow panel width (E4)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapSelectionDetail.svelte'),
			'utf-8',
		);

		// The Live list carries the data-slot hook the compact treatment + tests anchor on.
		expect(source).toMatch(/class="map-live-list" data-slot="live-departures"/);

		// A narrow PANEL-width container query (right-panel, the dock's own width)
		// collapses the Past/Next/Live three-up into a single tidy compact list —
		// the Past column drops and the columns stack as a flex list. The query keys
		// off the PARENT container (right-panel), not a self-target.
		expect(source).toMatch(
			/@container right-panel \(max-width: 17rem\)[\s\S]*\.map-time-columns\s*\{[\s\S]*flex-direction:\s*column/,
		);
		expect(source).toMatch(
			/@container right-panel \(max-width: 17rem\)[\s\S]*\.map-time-col--past\s*\{[\s\S]*display:\s*none/,
		);
	});
});
