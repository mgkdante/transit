import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { OCCUPANCY_LABELS, STATUS_LABELS } from '$lib/v1/enumLabels';
import { occupancyGlyph } from '$lib/components/dataviz';
import { buildLiveIndex } from '$lib/v1/live';
import type { Alert, IsoUtc, RouteFile, StopFile, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import MapSelectionDetail from './MapSelectionDetail.svelte';
import DetailBusRow from './detail/DetailBusRow.svelte';
import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
import { detailActions } from './mapSelectionDetail.logic';
import { resolveMapSelection } from './mapSelection';

const utc = (value: string) => value as IsoUtc;

function detailValue(container: HTMLElement, label: string): HTMLElement {
	const term = [...container.querySelectorAll('dt')].find((node) => node.textContent === label);
	const value = term?.parentElement?.querySelector<HTMLElement>('dd');
	if (!value) throw new Error(`missing detail value for ${label}`);
	return value;
}

function expectHiddenGlyph(
	value: HTMLElement,
	kind: 'status' | 'crowding',
	code: string,
	glyph: string,
): void {
	const node = value.querySelector<HTMLElement>(
		`[data-m6d-glyph-kind="${kind}"][data-m6d-glyph-code="${code}"]`,
	);
	expect(node?.textContent).toBe(glyph);
	expect(node).toHaveAttribute('aria-hidden', 'true');
}

function expectAccessibleContentName(value: HTMLElement, expected: string): void {
	const probe = document.createElement('button');
	probe.replaceChildren(...Array.from(value.childNodes, (node) => node.cloneNode(true)));
	document.body.append(probe);
	try {
		expect(probe).toHaveAccessibleName(expected);
	} finally {
		probe.remove();
	}
}

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
		description: '<p>La ligne <strong>24</strong> est détournée via Pine &amp; Clark.</p>',
		description_en: '<p>Route <strong>24</strong> is diverted via Pine &amp; Clark.</p>',
		routes: ['24'],
		stops: [],
	},
	{
		id: 'stop-alert',
		severity: 'watch',
		header_key: 'Stop moved',
		header_text: 'Stop moved',
		description: '<p>Arrêt 52618 déplacé au coin <strong>nord-est</strong>.</p>',
		description_en: '<p>Stop 52618 moved to the <strong>northeast</strong> corner.</p>',
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
	it.each([
		['en', 'America/Toronto', '20:06', '20:16'],
		['fr', 'America/Toronto', '20 h 06', '20 h 16'],
		['en', 'America/Vancouver', '17:06', '17:16'],
		['fr', 'America/Vancouver', '17 h 06', '17 h 16'],
	] as const)(
		'keeps trip stops and selected-zone ETAs when the vehicle next stop is unreported (%s, %s)',
		(locale, timeZone, firstTime, secondTime) => {
			const changedIndex = {
				...index,
				byVehicleId: new Map(index.byVehicleId).set('veh-1', { ...vehicles[0], next_stop: null }),
			};
			const detail = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-1' },
				{
					index: changedIndex,
					stops,
					alerts,
					routes,
				},
			);
			const { container } = render(MapSelectionDetail, { props: { detail, locale, timeZone } });
			expect(detailValue(container, 'ETA')).toHaveTextContent(firstTime);
			expect([...container.querySelectorAll('time')].map((node) => node.textContent)).toEqual([
				firstTime,
				secondTime,
			]);
			expect(container.querySelector('[data-detail-stop-id="stop-2"]')).toHaveAccessibleName(
				expect.stringContaining(firstTime),
			);
			expect(container).toHaveTextContent(
				locale === 'en' ? 'not reported in the live feed' : 'non signalé dans le flux en direct',
			);
			expect(container).not.toHaveTextContent(
				locale === 'en' ? 'the trip has ended' : 'le trajet est terminé',
			);
			expect(container).toHaveTextContent('Mont-Royal / Saint-Laurent');
			expect(container).toHaveTextContent('Van Horne / Rockland');
			expect(detail?.kind === 'vehicle' && detail.nextStops[0].etaUtc).toBe('2026-06-15T00:06:00Z');
		},
	);

	it('keeps body, identity, and action as mutually exclusive presentations', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const identity = render(MapSelectionDetail, {
			props: { detail, locale: 'en', presentation: 'identity' },
		});
		expect(identity.container.querySelector('[data-slot="detail-identity"]')).toHaveTextContent(
			'Vehicle veh-1',
		);
		expect(identity.container.querySelector('[data-slot="detail-body"]')).not.toBeInTheDocument();
		expect(
			identity.container.querySelector('[data-slot="detail-footer-action"]'),
		).not.toBeInTheDocument();

		const action = render(MapSelectionDetail, {
			props: { detail, locale: 'en', presentation: 'action' },
		});
		expect(action.container.querySelector('[data-slot="detail-footer-action"]')).toHaveAttribute(
			'href',
			'/trip/trip-24-a',
		);
		expect(action.container.querySelector('[data-slot="detail-body"]')).not.toBeInTheDocument();
		expect(action.container.querySelector('[data-slot="detail-identity"]')).not.toBeInTheDocument();

		const body = render(MapSelectionDetail, {
			props: { detail, locale: 'en', presentation: 'body' },
		});
		expect(body.container.querySelector('[data-slot="detail-body"]')).toBeInTheDocument();
		expect(body.container.querySelector('[data-slot="detail-identity"]')).not.toBeInTheDocument();
		expect(
			body.container.querySelector('[data-slot="detail-footer-action"]'),
		).not.toBeInTheDocument();

		const nullIdentity = render(MapSelectionDetail, {
			props: { detail: null, locale: 'fr', presentation: 'identity' },
		});
		expect(nullIdentity.container.querySelector('[data-slot="detail-identity"]')).toHaveTextContent(
			'Détails',
		);
	});

	it('renders no action for an absent detail or a vehicle with no honest destination', () => {
		const noDetail = render(MapSelectionDetail, {
			props: { detail: null, locale: 'en', presentation: 'action' },
		});
		expect(
			noDetail.container.querySelector('[data-slot="detail-footer-action"]'),
		).not.toBeInTheDocument();
		const noDestination = {
			kind: 'vehicle',
			id: 'veh-none',
			title: 'ignored',
			vehicle: {
				id: 'veh-none',
				lat: 45.5,
				lon: -73.6,
				status: 'unknown',
				updated_utc: utc('2026-06-15T00:00:00Z'),
				route: null,
				trip: null,
				next_stop: null,
				bearing: null,
				delay_min: null,
				occupancy: null,
			},
			trip: null,
			route: null,
			routeDirection: null,
			routeDirectionVariant: null,
			nextStop: null,
			nextStopAbsence: 'not-reported',
			pastStops: [],
			nextStops: [],
			alerts: [],
			routeType: null,
		} as const;
		const noVehicleAction = render(MapSelectionDetail, {
			props: { detail: noDestination, locale: 'en', presentation: 'action' },
		});
		expect(
			noVehicleAction.container.querySelector('[data-slot="detail-footer-action"]'),
		).not.toBeInTheDocument();
	});

	it('keeps vehicle chips to vehicle identity and route while status stays in the status band', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { container } = render(MapSelectionDetail, { props: { detail, locale: 'en' } });
		const chips = container.querySelector('[data-slot="detail-meta"]')!;
		expect(chips).toHaveTextContent('Vehicle veh-1');
		expect(chips).toHaveTextContent('Route 24');
		expect(chips).not.toHaveTextContent('Late');
		expect(chips).not.toHaveTextContent('Standing');
		expect(chips).not.toHaveTextContent('Trip trip-24-a');
		const statusBand = container.querySelector<HTMLElement>('[data-slot="detail-status-band"]')!;
		expect(statusBand).toHaveTextContent('▲ Late');
		expect(statusBand).toHaveTextContent(`${occupancyGlyph('standing')} Standing`);
	});

	it.each([
		{
			locale: 'en',
			statusLabel: 'Status',
			crowdingLabel: 'Crowding',
			status: '▲ Late',
			statusName: 'Late +4 min',
			occupancyName: 'Standing',
		},
		{
			locale: 'fr',
			statusLabel: 'Statut',
			crowdingLabel: 'Achalandage',
			status: '▲ En retard',
			statusName: 'En retard +4 min',
			occupancyName: 'Debout',
		},
	] as const)(
		'prefixes normal $locale status-band values with hidden canonical glyphs',
		({ locale, statusLabel, crowdingLabel, status, statusName, occupancyName }) => {
			const detail = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-1' },
				{ index, stops, alerts, routes },
			);
			const { container } = render(MapSelectionDetail, { props: { detail, locale } });
			const statusValue = detailValue(container, statusLabel);
			const occupancyValue = detailValue(container, crowdingLabel);

			expect(statusValue).toHaveTextContent(status);
			expect(occupancyValue).toHaveTextContent(`${occupancyGlyph('standing')} ${occupancyName}`);
			expectHiddenGlyph(statusValue, 'status', 'late', '▲');
			expectHiddenGlyph(occupancyValue, 'crowding', 'standing', occupancyGlyph('standing'));
			expectAccessibleContentName(statusValue, statusName);
			expectAccessibleContentName(occupancyValue, occupancyName);
		},
	);

	it('maps status and crowding glyphs to their canonical tokens while retaining text', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { container } = render(MapSelectionDetail, { props: { detail, locale: 'en' } });
		const status = container.querySelector<HTMLElement>(
			'[data-m6d-glyph-kind="status"][data-m6d-glyph-code="late"]',
		);
		const crowding = container.querySelector<HTMLElement>(
			'[data-m6d-glyph-kind="crowding"][data-m6d-glyph-code="standing"]',
		);

		expect(status?.getAttribute('style')).toContain('--glyph: var(--dataviz-status-late)');
		expect(crowding?.getAttribute('style')).toContain('--glyph: var(--dataviz-occupancy-standing)');
		expect(detailValue(container, 'Status')).toHaveTextContent('▲ Late');
		expect(detailValue(container, 'Crowding')).toHaveTextContent('▇ Standing');
	});

	it.each([
		{ delayMin: 0, status: 'on_time', want: '● On-time', absence: false },
		{ delayMin: 4, status: 'late', want: '▲ Late · +4 min', absence: false },
		{
			delayMin: null,
			status: 'unknown',
			want: 'not reported in the live feed',
			absence: true,
		},
	] as const)(
		'merges delay $delayMin into the vehicle status fact without a duplicate delay row',
		({ delayMin, status, want, absence }) => {
			const delayIndex = buildLiveIndex({
				vehicles: {
					generated_utc: utc('2026-06-15T00:00:00Z'),
					vehicles: [{ ...vehicles[0]!, status, delay_min: delayMin }],
				},
				trips: { generated_utc: utc('2026-06-15T00:00:00Z'), trips: {} },
				stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
			});
			const detail = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-1' },
				{ index: delayIndex, stops, alerts, routes },
			);
			const { container } = render(MapSelectionDetail, { props: { detail, locale: 'en' } });
			const statusValue = detailValue(container, 'Status');

			expect(statusValue).toHaveTextContent(want);
			expect(statusValue.querySelector('[data-slot="absent-value"]') != null).toBe(absence);
			if (delayMin == null) expect(statusValue.textContent?.match(/Unknown/g)).toHaveLength(1);
			expect([...container.querySelectorAll('dt')].map((term) => term.textContent)).not.toContain(
				'Delay',
			);
		},
	);

	it.each([
		{ locale: 'en', crowdingLabel: 'Crowding', name: 'Full' },
		{ locale: 'fr', crowdingLabel: 'Achalandage', name: 'Plein' },
	] as const)(
		'renders the terminal full mark as the hidden canonical glyph in $locale',
		({ locale, crowdingLabel, name }) => {
			const fullIndex = buildLiveIndex({
				vehicles: {
					generated_utc: utc('2026-06-15T00:00:00Z'),
					vehicles: [{ ...vehicles[0]!, id: 'veh-full', occupancy: 'full' }],
				},
				trips: { generated_utc: utc('2026-06-15T00:00:00Z'), trips: {} },
				stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
			});
			const detail = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-full' },
				{ index: fullIndex, stops, alerts, routes },
			);
			const { container } = render(MapSelectionDetail, { props: { detail, locale } });
			const occupancyValue = detailValue(container, crowdingLabel);
			const glyph = occupancyGlyph('full');

			expect(occupancyValue).toHaveTextContent(`${glyph} ${name}`);
			expectHiddenGlyph(occupancyValue, 'crowding', 'full', glyph);
			expectAccessibleContentName(occupancyValue, name);
		},
	);

	it.each([
		{
			locale: 'en',
			statusLabel: 'Status',
			crowdingLabel: 'Crowding',
			status: '○ Unknown',
			unknown: 'Unknown',
			reason: 'not reported in the live feed',
			occupancyName: 'Unknown, not reported in the live feed',
			empty: 'Empty',
		},
		{
			locale: 'fr',
			statusLabel: 'Statut',
			crowdingLabel: 'Achalandage',
			status: '○ Inconnu',
			unknown: 'Inconnu',
			reason: 'non signalé dans le flux',
			occupancyName: 'Inconnu, non signalé dans le flux en direct',
			empty: 'Vide',
		},
	] as const)(
		'keeps null occupancy honest with the no-data glyph in $locale',
		({ locale, statusLabel, crowdingLabel, status, unknown, reason, occupancyName, empty }) => {
			const nullOccupancyIndex = buildLiveIndex({
				vehicles: {
					generated_utc: utc('2026-06-15T00:00:00Z'),
					vehicles: [
						{
							...vehicles[0]!,
							id: 'veh-no-occupancy',
							status: 'unknown',
							delay_min: 0,
							occupancy: null,
						},
					],
				},
				trips: { generated_utc: utc('2026-06-15T00:00:00Z'), trips: {} },
				stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
			});
			const detail = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-no-occupancy' },
				{ index: nullOccupancyIndex, stops, alerts, routes },
			);
			const { container } = render(MapSelectionDetail, { props: { detail, locale } });
			const statusValue = detailValue(container, statusLabel);
			const occupancyValue = detailValue(container, crowdingLabel);
			const noDataGlyph = occupancyGlyph(null);

			expect(statusValue).toHaveTextContent(status);
			expect(occupancyValue).toHaveTextContent(noDataGlyph);
			expect(occupancyValue).toHaveTextContent(unknown);
			expect(occupancyValue).toHaveTextContent(reason);
			expect(occupancyValue.querySelector('[data-slot="absent-value"]')).toHaveAttribute(
				'data-density',
				'chip',
			);
			expect(occupancyValue).not.toHaveTextContent(occupancyGlyph('empty'));
			expect(occupancyValue).not.toHaveTextContent(empty);
			expectHiddenGlyph(statusValue, 'status', 'unknown', '○');
			expectHiddenGlyph(occupancyValue, 'crowding', 'nodata', noDataGlyph);
			expectAccessibleContentName(statusValue, `${unknown} 0 min`);
			expectAccessibleContentName(occupancyValue, occupancyName);
		},
	);

	it.each([
		['America/Toronto', '20:06', '20:36'],
		['America/Vancouver', '17:06', '17:36'],
	])('renders both departure rungs in %s', (timeZone, firstTime, lastTime) => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
		);
		if (detail?.kind !== 'stop') throw new Error('expected stop detail');
		const expandedDetail = {
			...detail,
			departures: [
				...(detail.departures ?? []),
				{ route: '18', trip: 'trip-18-a', eta_utc: utc('2026-06-15T00:26:00Z'), delay_min: 0 },
				{ route: '80', trip: 'trip-80-a', eta_utc: utc('2026-06-15T00:36:00Z'), delay_min: 0 },
			],
		};
		const { container } = render(MapSelectionDetail, {
			props: { detail: expandedDetail, locale: 'en', timeZone },
		});
		expect(container.querySelector('[data-slot="detail-departures"] time')).toHaveTextContent(
			firstTime,
		);
		expect(container.querySelector('[data-slot="detail-more-departures"] li')).toHaveTextContent(
			lastTime,
		);
		const routeTimes = container.querySelector<HTMLElement>('[data-slot="detail-route-times"]')!;
		const moreDepartures = container.querySelector<HTMLElement>(
			'[data-slot="detail-more-departures"]',
		)!;
		expect(routeTimes).toHaveAttribute('data-ladder-min', '420');
		expect(moreDepartures).toHaveAttribute('data-ladder-expand', '560');
		expect(routeTimes.compareDocumentPosition(moreDepartures)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(
			container.querySelector('[data-slot="detail-more-departures"] details'),
		).not.toBeInTheDocument();
		expect(
			container.querySelector('[data-slot="detail-more-departures-content"]'),
		).toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-schedule-tail"]')).not.toHaveAttribute(
			'open',
		);
	});

	it('links the +N more indicator to the exact full-analysis action through DetailInlineAction', () => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
		);
		if (detail?.kind !== 'stop') throw new Error('expected stop detail');
		const expandedDetail = {
			...detail,
			departures: [
				...(detail.departures ?? []),
				{ route: '18', trip: 'trip-18-a', eta_utc: utc('2026-06-15T00:26:00Z'), delay_min: 0 },
				{ route: '80', trip: 'trip-80-a', eta_utc: utc('2026-06-15T00:36:00Z'), delay_min: 0 },
			],
		};
		const fullAction = detailActions(expandedDetail, 'en');
		const { container } = render(MapSelectionDetail, {
			props: { detail: expandedDetail, locale: 'en' },
		});
		const moreDepartures = container.querySelector<HTMLElement>(
			'[data-slot="detail-more-departures"]',
		)!;
		const moreAction = moreDepartures.querySelector<HTMLAnchorElement>(
			'[data-slot="detail-more-departures-action"]',
		);

		expect(fullAction).not.toBeNull();
		expect(moreAction).toHaveClass('detail-inline-action');
		expect(moreAction).toHaveAttribute('href', fullAction!.href);
		expect(moreAction).toHaveTextContent('+1 more');
		expect(moreDepartures.querySelector('h3')?.textContent ?? '').not.toContain('+1 more');
	});

	it.each([
		['America/Toronto', '20:06'],
		['America/Vancouver', '17:06'],
	])('composes each bus row name with its %s ETA', (timeZone, expectedTime) => {
		const { getByRole } = render(DetailBusRow, {
			props: {
				vehicle: vehicles[0],
				etaUtc: utc('2026-06-15T00:06:00Z'),
				timeZone,
				locale: 'en',
				t: MAP_SELECTION_DETAIL_COPY.en,
				onselect: () => {},
			},
		});
		expect(getByRole('button')).toHaveAccessibleName(
			`Select vehicle veh-1, Route 24, ${expectedTime}, Late, Delay: +4 min`,
		);
	});

	it('keeps row preview until both pointer and keyboard focus leave without changing selection', async () => {
		const vehicleDetail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const stopDetail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-2' },
			{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
		);
		const onpreview = vi.fn();
		const selected = vi.fn();
		async function checkPreview(
			row: HTMLElement,
			selection: { kind: 'stop' | 'vehicle'; id: string },
		) {
			for (const [event, active] of [
				['pointerEnter', true],
				['focus', true],
				['pointerLeave', true],
				['blur', false],
				['focus', true],
				['pointerEnter', true],
				['blur', true],
				['pointerLeave', false],
			] as const) {
				await fireEvent[event](row);
				expect(row).toHaveAttribute('data-previewing', String(active));
				expect(onpreview).toHaveBeenLastCalledWith(active ? selection : null);
			}
		}
		const vehicleRender = render(MapSelectionDetail, {
			props: { detail: vehicleDetail, locale: 'en', onselect: selected, onpreview },
		});
		const stopRow = vehicleRender.getByRole('button', {
			name: /Select stop Mont-Royal \/ Saint-Laurent,/,
		});

		await checkPreview(stopRow, { kind: 'stop', id: 'stop-2' });

		vehicleRender.unmount();
		onpreview.mockClear();
		const stopRender = render(MapSelectionDetail, {
			props: { detail: stopDetail, locale: 'en', onselect: selected, onpreview },
		});
		const busRow = stopRender.getByRole('button', { name: /^Select vehicle veh-1,/ });
		await checkPreview(busRow, { kind: 'vehicle', id: 'veh-1' });
		expect(selected).not.toHaveBeenCalled();
	});

	it('preserves a focused stop row through a same-entity refeed and reorder', async () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		if (detail?.kind !== 'vehicle') throw new Error('expected vehicle detail');
		const { getByRole, rerender } = render(MapSelectionDetail, { props: { detail, locale: 'en' } });
		const focused = getByRole('button', { name: /Select stop Mont-Royal \/ Saint-Laurent,/ });
		focused.focus();

		await rerender({ detail: { ...detail, nextStops: [...detail.nextStops] }, locale: 'en' });
		expect(document.activeElement).toBe(focused);
		await rerender({
			detail: { ...detail, nextStops: [...detail.nextStops].reverse() },
			locale: 'en',
		});
		expect(document.activeElement).toBe(focused);
	});

	it('keeps focus on a drill-in stop row through its selection callback', async () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const onselect = vi.fn();
		const { getByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', onselect },
		});
		const drillIn = getByRole('button', { name: /Select stop Mont-Royal \/ Saint-Laurent,/ });
		drillIn.focus();
		await fireEvent.click(drillIn);

		expect(onselect).toHaveBeenCalledWith({ kind: 'stop', id: 'stop-2' });
		expect(document.activeElement).toBe(drillIn);
	});

	it('preserves a focused null-trip departure through same-entity reordering', async () => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
		);
		if (detail?.kind !== 'stop') throw new Error('expected stop detail');
		const nullTripDepartures = [
			{ route: '24', trip: null, eta_utc: utc('2026-06-15T00:06:00Z'), delay_min: 4 },
			{ route: '55', trip: null, eta_utc: utc('2026-06-15T00:16:00Z'), delay_min: 0 },
		];
		const { container, rerender } = render(MapSelectionDetail, {
			props: { detail: { ...detail, departures: nullTripDepartures }, locale: 'en' },
		});
		const focused = container.querySelector<HTMLButtonElement>(
			'[data-departure-key="24:2026-06-15T00:06:00Z"] button',
		)!;
		focused.focus();

		await rerender({
			detail: { ...detail, departures: [...nullTripDepartures].reverse() },
			locale: 'en',
		});
		expect(document.activeElement).toBe(focused);
	});

	it('keeps the sequence-unknown aria receipt on route stop rows', () => {
		const detail = resolveMapSelection(
			{ kind: 'route', id: '24' },
			{ index, stops, alerts, routes },
		);
		if (detail?.kind !== 'route') throw new Error('expected route detail');
		const direction = detail.directions[0]!;
		const withUnknownSequence = {
			...detail,
			directions: [
				{
					...direction,
					stops: [{ ...direction.stops[0]!, seq: null }, ...direction.stops.slice(1)],
				},
			],
		};
		const { getByRole } = render(MapSelectionDetail, {
			props: { detail: withUnknownSequence, locale: 'en' },
		});
		expect(
			getByRole('button', { name: 'Select stop Sherbrooke / Saint-Denis, Sequence unknown' }),
		).toBeInTheDocument();
	});
	it('leaves the semantic identity to its shell and opens vehicle detail with a status band', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { container, queryByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'en' },
		});

		expect(queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-status-band"]')).toHaveTextContent(
			'Next stop',
		);
	});

	it('shows failed retained detail visually and forwards the retry affordance without a live region', async () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const onrefresh = vi.fn();
		const { container, getByRole, getByText, queryByRole } = render(MapSelectionDetail, {
			props: {
				detail,
				locale: 'en',
				selectionPresence: 'missing-grace',
				selectionSourceHealth: 'failed',
				onrefresh,
			},
		});

		expect(getByText('Live detail is unavailable')).toBeInTheDocument();
		expect(queryByRole('status')).not.toBeInTheDocument();
		const retry = getByRole('button', { name: 'Retry' });
		expect(retry).toHaveClass('detail-retry');
		await fireEvent.click(retry);
		expect(onrefresh).toHaveBeenCalledTimes(1);
		expect(container.querySelector('[data-source-health="failed"]')).toBeInTheDocument();
	});

	it('marks missing-grace with a healthy source as stale without offering retry', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { getByText, queryByRole } = render(MapSelectionDetail, {
			props: {
				detail,
				locale: 'en',
				selectionPresence: 'missing-grace',
				selectionSourceHealth: 'ok',
			},
		});

		expect(getByText('Showing the last available detail')).toBeInTheDocument();
		expect(queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	it('allows a retry while missing-grace is refreshing', async () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const onrefresh = vi.fn();
		const { getByRole, getByText } = render(MapSelectionDetail, {
			props: {
				detail,
				locale: 'en',
				selectionPresence: 'missing-grace',
				selectionSourceHealth: 'retrying',
				onrefresh,
			},
		});

		expect(getByText('Refreshing live detail')).toBeInTheDocument();
		await fireEvent.click(getByRole('button', { name: 'Retry' }));
		expect(onrefresh).toHaveBeenCalledTimes(1);
	});

	it('renders a vehicle detail with status, crowding, next stop, and alerts', async () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const onselect = vi.fn();
		const onfilter = vi.fn();
		const onalertselect = vi.fn();
		const { container, getAllByRole, getAllByText, getByRole, getByText } = render(
			MapSelectionDetail,
			{
				props: { detail, locale: 'en', onselect, onfilter, onalertselect },
			},
		);

		expect(getByText('Vehicle veh-1')).toBeInTheDocument();
		expect(detailValue(container, 'Status')).toHaveTextContent('▲ Late');
		expect(detailValue(container, 'Crowding')).toHaveTextContent(
			`${occupancyGlyph('standing')} Standing`,
		);
		expect(getByText('Past stops')).toBeInTheDocument();
		expect(getByText('Next stops')).toBeInTheDocument();
		expect(getByText('Sherbrooke / Saint-Denis')).toBeInTheDocument();
		expect(getAllByText('Mont-Royal / Saint-Laurent').length).toBeGreaterThan(0);
		expect(getByText('Van Horne / Rockland')).toBeInTheDocument();
		expect(
			getByRole('button', { name: 'Select alert Route 24 is diverted via Pine & Clark.' }),
		).toBeInTheDocument();
		expect(
			getByRole('button', { name: 'Select alert Stop 52618 moved to the northeast corner.' }),
		).toBeInTheDocument();

		if (detail?.kind !== 'vehicle') throw new Error('expected vehicle detail');
		await fireEvent.click(getByRole('button', { name: 'Select route 24' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'route', id: '24' });

		await fireEvent.click(
			getAllByRole('button', { name: /Select stop Mont-Royal \/ Saint-Laurent,/ })[0],
		);
		expect(onselect).toHaveBeenCalledWith({ kind: 'stop', id: 'stop-2' });

		const locationBeforeAlertTap = window.location.href;
		await fireEvent.click(
			getByRole('button', { name: 'Select alert Route 24 is diverted via Pine & Clark.' }),
		);
		expect(onalertselect).toHaveBeenCalledTimes(1);
		expect(onalertselect.mock.calls[0]?.[0]).toBe(alerts[0]);
		expect(window.location.href).toBe(locationBeforeAlertTap);
	});

	it('makes vehicle facts useful while keeping the selected bus identity passive', async () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const onselect = vi.fn();
		const onfilter = vi.fn();
		const { getByRole, queryByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', onselect, onfilter },
		});

		expect(queryByRole('button', { name: 'Select vehicle veh-1' })).not.toBeInTheDocument();
		await fireEvent.click(getByRole('button', { name: 'Filter status Late' }));
		expect(onfilter).toHaveBeenLastCalledWith({ kind: 'status', value: 'late' });
		await fireEvent.click(getByRole('button', { name: 'Filter crowding Standing' }));
		expect(onfilter).toHaveBeenLastCalledWith({ kind: 'occupancy', value: 'standing' });
		await fireEvent.click(getByRole('button', { name: 'Filter trip trip-24-a' }));
		expect(onfilter).toHaveBeenLastCalledWith({ kind: 'trip', value: 'trip-24-a' });
		await fireEvent.click(getByRole('button', { name: 'Select stop Mont-Royal / Saint-Laurent' }));
		expect(onselect).toHaveBeenLastCalledWith({ kind: 'stop', id: 'stop-2' });
	});

	it.each([
		{ alertState: null, message: 'Alert data unavailable' },
		{ alertState: [] as Alert[], message: 'No alerts attached' },
	])('distinguishes $message in the detail surface', ({ alertState, message }) => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		if (detail?.kind !== 'vehicle') throw new Error('expected vehicle detail');
		const { getByText } = render(MapSelectionDetail, {
			props: { detail: { ...detail, alerts: alertState }, locale: 'en' },
		});
		expect(getByText(message)).toBeInTheDocument();
	});

	it('renders a per-bus not-reporting GPS note when the vehicle fix is stale', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { container, getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: { ageS: 180 } },
		});

		const note = container.querySelector('.map-not-reporting')!;
		expect(note).toBeInTheDocument();
		expect(note).not.toHaveAttribute('role');
		expect(note).toHaveAttribute('data-density', 'chip');
		expect(note).toHaveTextContent('No recent position');
		expect(note).toHaveTextContent('3 min');
		expect(note.textContent).not.toContain('—');
		expect(getByText(/last seen 3 min ago/)).toBeInTheDocument();
	});

	it('renders the not-reporting age in seconds for a recently-silent bus', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: { ageS: 45 } },
		});

		expect(getByText(/last seen 45 s ago/)).toBeInTheDocument();
	});

	it('renders the not-reporting note in French', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { getByText, queryByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'fr', notReporting: { ageS: 180 } },
		});

		const note = getByText(/Aucune position récente/).closest('.map-not-reporting');
		expect(note).toHaveTextContent('Aucune position récente');
		expect(note).toHaveTextContent('dernière position il y a 3 min');
		expect(queryByRole('status')).not.toBeInTheDocument();
	});

	it('hides the not-reporting note when notReporting is null', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { queryByText, queryByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: null },
		});

		expect(queryByText(/No recent position/)).not.toBeInTheDocument();
		expect(queryByRole('status')).not.toBeInTheDocument();
	});

	it.each(['en', 'fr'] as const)('reports actual departure counts in %s', async (locale) => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
		);
		if (detail?.kind !== 'stop') throw new Error('expected stop detail');
		const view = render(MapSelectionDetail, { props: { detail, locale } });
		for (const [count, en, fr] of [
			[null, 'Live departures unavailable', 'Départs en direct indisponibles'],
			[0, '0 departures', '0 départs'],
			[1, '1 departure', '1 départ'],
			[2, '2 departures', '2 départs'],
			[5, '5 departures', '5 départs'],
		] as const) {
			const departures =
				count == null
					? null
					: Array.from({ length: count }, (_, i) => ({
							route: '24',
							trip: `trip-${i}`,
							eta_utc: utc('2026-06-15T16:40:00Z'),
							delay_min: 0,
						}));
			await view.rerender({ detail: { ...detail, departures }, locale });
			const grid = view.container.querySelector('.detail-attribute-grid');
			expect
				.soft(grid?.querySelector('dt'))
				.toHaveTextContent(locale === 'en' ? 'Departures' : 'Départs');
			expect.soft(grid?.querySelector('dd')).toHaveTextContent(locale === 'en' ? en : fr);
			if (count === 5) {
				expect(view.container.querySelectorAll('[data-slot="detail-departures"] li')).toHaveLength(
					3,
				);
				expect(
					view.container.querySelectorAll('[data-slot="detail-more-departures"] li'),
				).toHaveLength(2);
				expect(
					view.container.querySelector('[data-slot="detail-more-departures-action"]'),
				).toHaveTextContent(locale === 'en' ? '+2 more' : '+2 de plus');
			}
		}
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

		expect(getByText('Stop code 52618')).toBeInTheDocument();
		expect(getAllByText('2 departures').length).toBeGreaterThan(0);
		expect(getByText('0 vehicles heading here')).toBeInTheDocument();
		expect(getAllByText(/Route 24/).length).toBeGreaterThan(0);
		expect(getAllByText(/Past times:/).length).toBeGreaterThan(0);
		expect(getAllByText(/Next times:/).length).toBeGreaterThan(0);
		expect(getByText(/08:00/)).toBeInTheDocument();
		expect(getByText(/23:50/)).toBeInTheDocument();
		expect(
			getByRole('button', { name: 'Select alert Stop 52618 moved to the northeast corner.' }),
		).toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Select departure route 24' }));
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

		await fireEvent.click(getByRole('button', { name: /^Select vehicle veh-1,/ }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-1' });

		await fireEvent.click(getByRole('button', { name: /^Select vehicle veh-2,/ }));
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
		expect(getByText('Sherbrooke')).toBeInTheDocument();
		expect(getAllByText('toward Van Horne / Rockland').length).toBeGreaterThan(0);
		expect(getByText('2 vehicles visible')).toBeInTheDocument();
		expect(getByText('Stops')).toBeInTheDocument();
		expect(getByText('Sherbrooke / Saint-Denis')).toBeInTheDocument();
		expect(getByText('Mont-Royal / Saint-Laurent')).toBeInTheDocument();
		expect(getByText('Van Horne / Rockland')).toBeInTheDocument();
		expect(
			getByRole('button', { name: 'Select alert Route 24 is diverted via Pine & Clark.' }),
		).toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: /Select stop Van Horne \/ Rockland,/ }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'stop', id: 'stop-3' });

		await fireEvent.click(getByRole('button', { name: /^Select vehicle veh-1,/ }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-1' });
	});

	it('renders a null delay as the honest absence (unknown + why), never "No delay" or "On time"', () => {
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

		const status = detailValue(container, 'Status');
		const absent = status.querySelector('[data-slot="absent-value"][data-tone="unknown"]');
		expect(absent).not.toBeNull();
		expect(absent).toHaveAttribute('data-density', 'chip');
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

		const absent = [
			...container.querySelectorAll('.map-detail-grid [data-slot="absent-value"]'),
		].find((node) => node.textContent?.includes('this vehicle is not reporting'));
		expect(absent).not.toBeNull();
		expect(absent!.textContent).toContain('this vehicle is not reporting');
	});

	it('explains a metro vehicle null delay as metro-no-realtime ("No live data"), never not-reported or on-time', () => {
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

		const absent = [
			...container.querySelectorAll('.map-detail-grid [data-slot="absent-value"]'),
		].find((node) => node.textContent?.includes('live positions are not published here'));
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

		expect(queryByText('ghost-stop-999')).not.toBeInTheDocument();
		const absent = container.querySelector('[data-slot="absent-value"][data-tone="unknown"]');
		expect(absent).not.toBeNull();
		expect(container.textContent).toContain('not in the schedule');
	});

	it('renders a null stop name as the labelled fallback, never the bare id', () => {
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

		expect(getByText('Stop stop-2 (name unavailable)')).toBeInTheDocument();
	});
});

describe.each(['en', 'fr'] as const)('MapSelectionDetail published status in %s', (locale) => {
	it.each([
		['on_time', 1, '+1 min'],
		['late', 0, '0 min'],
		['early', -2, '−2 min'],
		['severe', 4, '+4 min'],
		['unknown', 0, '0 min'],
		['on_time', null, null],
		['unknown', null, null],
	] as const)('%s with delay %s', (status, delay, measurement) => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		if (detail?.kind !== 'vehicle') throw new Error('missing vehicle fixture');
		const { container } = render(MapSelectionDetail, {
			props: {
				detail: { ...detail, vehicle: { ...detail.vehicle, status, delay_min: delay } },
				locale,
			},
		});
		const fact = detailValue(container, locale === 'fr' ? 'Statut' : 'Status');
		expect(fact).toHaveTextContent(STATUS_LABELS[locale][status]);
		const glyph = fact.querySelector('[data-m6d-glyph-kind="status"]');
		expect(glyph).toHaveAttribute('data-m6d-glyph-code', status);
		expect(glyph).toHaveAttribute('aria-hidden', 'true');
		const reading = fact.querySelector('.detail-delay-measurement')!;
		if (measurement) {
			expect(reading).toHaveTextContent(measurement);
			expectAccessibleContentName(fact, `${STATUS_LABELS[locale][status]} ${measurement}`);
		} else expect(reading.querySelector('[data-slot="absent-value"]')).toBeInTheDocument();
		expect(reading.textContent).not.toMatch(/late|early|On time|retard|avance|heure/);
	});
});

describe.each(['en', 'fr'] as const)('DetailBusRow published status in %s', (locale) => {
	it.each([
		['on_time', 1, '+1 min'],
		['late', 0, '0 min'],
		['early', -2, '−2 min'],
		['severe', 4, '+4 min'],
		['unknown', 0, '0 min'],
		['on_time', null, null],
		['unknown', null, null],
	] as const)('%s with delay %s', (status, delay, measurement) => {
		const t = MAP_SELECTION_DETAIL_COPY[locale];
		const { container, getByRole } = render(DetailBusRow, {
			props: {
				vehicle: { ...vehicles[0], status, delay_min: delay },
				locale,
				t,
				onselect: vi.fn(),
			},
		});
		const badge = container.querySelector('[data-slot="status-badge"]');
		expect(badge).toHaveAttribute('data-status', status);
		const button = getByRole('button');
		if (status === 'unknown' && delay == null) {
			expect(badge).toHaveAttribute('aria-hidden', 'true');
			expect(badge).toHaveTextContent('○');
			expect(badge?.getAttribute('style')).toContain('--dataviz-status-unknown');
			expect(
				button.textContent?.match(new RegExp(STATUS_LABELS[locale].unknown, 'g')),
			).toHaveLength(1);
			expect(
				button.getAttribute('aria-label')?.match(new RegExp(STATUS_LABELS[locale].unknown, 'g')),
			).toHaveLength(1);
			expect(button.getAttribute('aria-label')).toContain(
				locale === 'en' ? 'not reported in the live feed' : 'non signalé dans le flux en direct',
			);
		}
		expect(button.getAttribute('aria-label')).toContain(STATUS_LABELS[locale][status]);
		if (measurement) {
			expect(button.getAttribute('aria-label')).toContain(`${t.delay}: ${measurement}`);
			expect(button).toHaveTextContent(measurement);
		} else expect(button.querySelector('[data-slot="absent-value"]')).toBeInTheDocument();
		expect(button.getAttribute('aria-label')).not.toMatch(
			/min late|min early|min en retard|min en avance/,
		);
	});
});

describe('vehicle attribute definition groups', () => {
	it.each(['en', 'fr'] as const)(
		'keeps every %s fact action inside its description group',
		async (locale) => {
			const detail = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-1' },
				{ index, stops, alerts, routes },
			);
			if (detail?.kind !== 'vehicle' || !detail.nextStop)
				throw new Error('expected vehicle next stop');
			const onselect = vi.fn();
			const onfilter = vi.fn();
			const view = render(MapSelectionDetail, { props: { detail, locale, onselect, onfilter } });
			const grid = view.container.querySelector('dl.detail-attribute-grid')!;
			for (const group of grid.children) {
				expect(group.tagName).toBe('DIV');
				const tags = [...group.children].map((element) => element.tagName);
				expect(tags[0]).toBe('DT');
				expect(tags.slice(1).every((tag) => tag === 'DD')).toBe(true);
			}
			const actions = [
				...grid.querySelectorAll<HTMLButtonElement>('.detail-attribute-action > button'),
			];
			const t = MAP_SELECTION_DETAIL_COPY[locale];
			expect(actions.map((button) => button.getAttribute('aria-label'))).toEqual([
				t.filterStatus(STATUS_LABELS[locale].late),
				t.selectStop(detail.nextStop.name),
				t.filterCrowding(OCCUPANCY_LABELS[locale].standing),
			]);
			await fireEvent.click(actions[0]);
			expect(onfilter).toHaveBeenLastCalledWith({ kind: 'status', value: 'late' });
			await fireEvent.click(actions[1]);
			expect(onselect).toHaveBeenLastCalledWith({ kind: 'stop', id: 'stop-2' });
			await fireEvent.click(actions[2]);
			expect(onfilter).toHaveBeenLastCalledWith({ kind: 'occupancy', value: 'standing' });
		},
	);
});
