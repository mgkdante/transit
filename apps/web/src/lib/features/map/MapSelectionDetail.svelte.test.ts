import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';
import { buildLiveIndex } from '$lib/v1/live';
import type { Alert, IsoUtc, RouteFile, StopFile, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import MapSelectionDetail from './MapSelectionDetail.svelte';
import DetailBusRow from './detail/DetailBusRow.svelte';
import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
import { detailActions } from './mapSelectionDetail.logic';
import { resolveMapSelection } from './mapSelection';

const utc = (value: string) => value as IsoUtc;

const PRESENCE_CSS_FILES = [
	'src/lib/features/map/MapSelectionDetail.svelte',
	'src/lib/features/map/detail/DetailStatPills.svelte',
	'src/lib/features/map/detail/DetailSection.svelte',
] as const;

const DETAIL_TARGET_CSS_FILES = [
	...PRESENCE_CSS_FILES,
	'src/lib/features/map/detail/DetailInlineAction.svelte',
	'src/lib/features/map/detail/DetailStopRow.svelte',
	'src/lib/features/map/detail/DetailBusRow.svelte',
	'src/lib/features/map/MapDetailAlerts.svelte',
] as const;

function compiledCss(file: string): string {
	return (
		compile(readFileSync(resolve(process.cwd(), file), 'utf8'), {
			filename: file,
			generate: 'client',
			css: 'external',
		}).css?.code ?? ''
	);
}

function splitContainerRules(css: string): {
	base: string;
	rules: { condition: string; body: string }[];
} {
	const marker = '@container right-panel';
	const rules: { condition: string; body: string }[] = [];
	let base = '';
	let cursor = 0;
	for (;;) {
		const start = css.indexOf(marker, cursor);
		if (start < 0) {
			base += css.slice(cursor);
			break;
		}
		base += css.slice(cursor, start);
		const open = css.indexOf('{', start + marker.length);
		if (open < 0) throw new Error('unclosed right-panel container query');
		let depth = 1;
		let end = open + 1;
		while (depth > 0 && end < css.length) {
			if (css[end] === '{') depth += 1;
			if (css[end] === '}') depth -= 1;
			end += 1;
		}
		if (depth !== 0) throw new Error('unclosed right-panel container rule');
		rules.push({
			condition: css.slice(start + marker.length, open).trim(),
			body: css.slice(open + 1, end - 1),
		});
		cursor = end;
	}
	return { base, rules };
}

const RIGHT_PANEL_INLINE_BORDER_PX = 1;

function containerConditionMatches(condition: string, outerWidthPx: number): boolean {
	// RightPanel owns one leading border. Translate both the named outer ladder
	// threshold and the sampled outer box into the content-box values queried by CSS.
	const contentWidthPx = outerWidthPx - RIGHT_PANEL_INLINE_BORDER_PX;
	const range = condition.match(/\(width\s*([<>])\s*([\d.]+)rem\)/);
	if (range) {
		const contentBoundaryPx = Number(range[2]) * 16;
		return range[1] === '<'
			? contentWidthPx < contentBoundaryPx
			: contentWidthPx > contentBoundaryPx;
	}
	const legacy = condition.match(/\((min|max)-width:\s*([\d.]+)rem\)/);
	if (!legacy) throw new Error(`unsupported container condition: ${condition}`);
	const contentBoundaryPx = Number(legacy[2]) * 16;
	return legacy[1] === 'min'
		? contentWidthPx >= contentBoundaryPx
		: contentWidthPx <= contentBoundaryPx;
}

function installContainerSizeSeam(outerWidthPx: number): HTMLStyleElement {
	const detailCss = splitContainerRules(compiledCss(PRESENCE_CSS_FILES[0]));
	const activeQueries = detailCss.rules
		.filter(({ condition }) => containerConditionMatches(condition, outerWidthPx))
		.map(({ body }) => body)
		.join('\n');
	const style = document.createElement('style');
	// Put activated query rules first on purpose: hides must beat later-emitted leaf defaults by
	// specificity, not by a lucky bundle order. Happy DOM then computes the real flattened cascade.
	style.textContent = [
		activeQueries,
		compiledCss(PRESENCE_CSS_FILES[1]),
		compiledCss(PRESENCE_CSS_FILES[2]),
		detailCss.base,
	].join('\n');
	document.head.append(style);
	return style;
}

function cssFloorPx(value: string): number {
	if (value.endsWith('rem')) return Number.parseFloat(value) * 16;
	if (value.endsWith('px')) return Number.parseFloat(value);
	return 0;
}

function expectHard44(element: Element): void {
	const computed = getComputedStyle(element);
	expect(
		Math.max(cssFloorPx(computed.minBlockSize), cssFloorPx(computed.minHeight)),
		`${element.tagName.toLowerCase()}.${element.className} lacks a 44px floor`,
	).toBeGreaterThanOrEqual(44);
}

function detailValue(container: HTMLElement, label: string): HTMLElement {
	const term = [...container.querySelectorAll('dt')].find((node) => node.textContent === label);
	const value = term?.parentElement?.querySelector<HTMLElement>('dd');
	if (!value) throw new Error(`missing detail value for ${label}`);
	return value;
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
	it('keeps body, identity, and action as mutually exclusive presentations', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const identity = render(MapSelectionDetail, {
			props: { detail, locale: 'en', presentation: 'identity' },
		});
		expect(identity.container.querySelector('[data-slot="detail-identity"]')).toHaveTextContent(
			'Bus veh-1',
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
			nextStopAbsence: 'end-of-route',
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
		expect(chips).toHaveTextContent('Bus veh-1');
		expect(chips).toHaveTextContent('Route 24');
		expect(chips).not.toHaveTextContent('Late');
		expect(chips).not.toHaveTextContent('Standing');
		expect(chips).not.toHaveTextContent('Trip trip-24-a');
		const statusBand = container.querySelector<HTMLElement>('[data-slot="detail-status-band"]')!;
		expect(statusBand).toHaveTextContent('▲ Late');
		expect(statusBand).toHaveTextContent('▇ Standing');
	});

	it.each([
		{
			locale: 'en',
			statusLabel: 'Status',
			crowdingLabel: 'Crowding',
			status: '▲ Late',
			occupancy: '▇ Standing',
		},
		{
			locale: 'fr',
			statusLabel: 'Statut',
			crowdingLabel: 'Achalandage',
			status: '▲ En retard',
			occupancy: '▇ Debout',
		},
	] as const)(
		'prefixes normal $locale status-band values with hidden canonical glyphs',
		({ locale, statusLabel, crowdingLabel, status, occupancy }) => {
			const detail = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-1' },
				{ index, stops, alerts, routes },
			);
			const { container } = render(MapSelectionDetail, { props: { detail, locale } });
			const statusValue = detailValue(container, statusLabel);
			const occupancyValue = detailValue(container, crowdingLabel);

			expect(statusValue).toHaveTextContent(status);
			expect(occupancyValue).toHaveTextContent(occupancy);
			expect(statusValue.querySelector('[data-m6d-glyph-kind="status"]')).toHaveAttribute(
				'aria-hidden',
				'true',
			);
			expect(occupancyValue.querySelector('[data-m6d-glyph-kind="crowding"]')).toHaveAttribute(
				'aria-hidden',
				'true',
			);
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
			empty: 'Empty',
		},
		{
			locale: 'fr',
			statusLabel: 'Statut',
			crowdingLabel: 'Achalandage',
			status: '○ Inconnu',
			unknown: 'Inconnu',
			reason: 'non signalé dans le flux',
			empty: 'Vide',
		},
	] as const)(
		'keeps null occupancy honest with the no-data glyph in $locale',
		({ locale, statusLabel, crowdingLabel, status, unknown, reason, empty }) => {
			const nullOccupancyIndex = buildLiveIndex({
				vehicles: {
					generated_utc: utc('2026-06-15T00:00:00Z'),
					vehicles: [
						{
							...vehicles[0]!,
							id: 'veh-no-occupancy',
							status: 'unknown',
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

			expect(statusValue).toHaveTextContent(status);
			expect(occupancyValue).toHaveTextContent('◌');
			expect(occupancyValue).toHaveTextContent(unknown);
			expect(occupancyValue).toHaveTextContent(reason);
			expect(occupancyValue).not.toHaveTextContent('▁');
			expect(occupancyValue).not.toHaveTextContent(empty);
			expect(occupancyValue.querySelector('[data-m6d-glyph-code="nodata"]')).toHaveAttribute(
				'aria-hidden',
				'true',
			);
		},
	);

	it('marks stop routes as the 420px rung and full departures as the 560px rung', () => {
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
			props: { detail: expandedDetail, locale: 'en' },
		});
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

	it('uses reachable, non-overlapping ladder thresholds and keeps the old dead tiers out', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapSelectionDetail.svelte'),
			'utf8',
		);
		expect(source).toContain('width < 26.25rem');
		expect(source).toContain('min-width: 34rem');
		expect(source).not.toContain('max-width: 26.25rem');
		expect(source).not.toContain('min-width: 26.25rem');
		expect(source).not.toContain('min-width: 35rem');
		expect(source).not.toMatch(/(?:max|min)-width:\s*(?:17|18)rem/);
		expect(source).not.toContain('--accent');
	});

	it.each([
		{ widthPx: 300, metaDisplay: 'none', routesDisplay: 'none', tailVisibility: 'hidden' },
		{ widthPx: 421, metaDisplay: 'flex', routesDisplay: 'grid', tailVisibility: 'hidden' },
		{ widthPx: 560, metaDisplay: 'flex', routesDisplay: 'grid', tailVisibility: 'visible' },
	])(
		'computes the presence table at a $widthPx px right-panel container',
		({ widthPx, metaDisplay, routesDisplay, tailVisibility }) => {
			const style = installContainerSizeSeam(widthPx);
			try {
				const vehicleDetail = resolveMapSelection(
					{ kind: 'vehicle', id: 'veh-1' },
					{ index, stops, alerts, routes },
				);
				const routeDetail = resolveMapSelection(
					{ kind: 'route', id: '24' },
					{ index, stops, alerts, routes },
				);
				const stop = resolveMapSelection(
					{ kind: 'stop', id: 'stop-1' },
					{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
				);
				if (stop?.kind !== 'stop') throw new Error('expected stop detail');
				const stopDetail = {
					...stop,
					departures: [
						...(stop.departures ?? []),
						{
							route: '18',
							trip: 'trip-18-a',
							eta_utc: utc('2026-06-15T00:26:00Z'),
							delay_min: 0,
						},
						{
							route: '80',
							trip: 'trip-80-a',
							eta_utc: utc('2026-06-15T00:36:00Z'),
							delay_min: 0,
						},
					],
				};

				for (const detail of [vehicleDetail, routeDetail]) {
					const rendered = render(MapSelectionDetail, { props: { detail, locale: 'en' } });
					expect(
						getComputedStyle(rendered.container.querySelector('[data-slot="detail-meta"]')!),
					).toHaveProperty('display', metaDisplay);
				}
				const renderedStop = render(MapSelectionDetail, {
					props: { detail: stopDetail, locale: 'en' },
				});
				expect(
					getComputedStyle(renderedStop.container.querySelector('[data-slot="detail-meta"]')!),
				).toHaveProperty('display', metaDisplay);
				expect(
					getComputedStyle(
						renderedStop.container.querySelector('[data-slot="detail-route-times"]')!,
					),
				).toHaveProperty('display', routesDisplay);
				expect(
					getComputedStyle(renderedStop.container.querySelector('[data-ladder-content]')!)
						.visibility,
				).toBe(tailVisibility);
			} finally {
				style.remove();
			}
		},
	);

	it.each([
		{ outerWidthPx: 419, display: 'none' },
		{ outerWidthPx: 420, display: 'none' },
		{ outerWidthPx: 421, display: 'flex' },
	])(
		'switches detail chips at the outer $outerWidthPx px seam with the border intact',
		({ outerWidthPx, display }) => {
			const style = installContainerSizeSeam(outerWidthPx);
			try {
				const detail = resolveMapSelection(
					{ kind: 'vehicle', id: 'veh-1' },
					{ index, stops, alerts, routes },
				);
				const { container } = render(MapSelectionDetail, { props: { detail, locale: 'en' } });
				expect(
					getComputedStyle(container.querySelector('[data-slot="detail-meta"]')!).display,
				).toBe(display);
			} finally {
				style.remove();
			}
		},
	);

	it.each([
		{ widthPx: 543, visibility: 'hidden' },
		{ widthPx: 544, visibility: 'hidden' },
		{ widthPx: 545, visibility: 'visible' },
	])(
		'switches the capped tail at the reachable $widthPx px boundary',
		({ widthPx, visibility }) => {
			const style = installContainerSizeSeam(widthPx);
			try {
				const stop = resolveMapSelection(
					{ kind: 'stop', id: 'stop-1' },
					{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
				);
				if (stop?.kind !== 'stop') throw new Error('expected stop detail');
				const { container } = render(MapSelectionDetail, {
					props: {
						detail: {
							...stop,
							departures: [
								...(stop.departures ?? []),
								{
									route: '18',
									trip: 'trip-18-a',
									eta_utc: utc('2026-06-15T00:26:00Z'),
									delay_min: 0,
								},
								{
									route: '80',
									trip: 'trip-80-a',
									eta_utc: utc('2026-06-15T00:36:00Z'),
									delay_min: 0,
								},
							],
						},
						locale: 'en',
					},
				});
				expect(getComputedStyle(container.querySelector('[data-ladder-content]')!).visibility).toBe(
					visibility,
				);
			} finally {
				style.remove();
			}
		},
	);

	it('composes each bus row name as entity, route, status, and delay', () => {
		const { getByRole } = render(DetailBusRow, {
			props: {
				vehicle: vehicles[0],
				etaUtc: utc('2026-06-15T00:06:00Z'),
				locale: 'en',
				t: MAP_SELECTION_DETAIL_COPY.en,
				onselect: () => {},
			},
		});
		expect(getByRole('button')).toHaveAccessibleName(
			'Select bus veh-1, Route 24, 20:06, Late, Delay: 4 min late',
		);
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

	it('keeps the parent and exact seven leaves within the frozen ceilings with unique declaration fingerprints', () => {
		const files = [
			'MapSelectionDetail.svelte',
			'detail/DetailStatPills.svelte',
			'detail/DetailAttributeGrid.svelte',
			'detail/DetailInlineAction.svelte',
			'detail/DetailSection.svelte',
			'detail/DetailStopRow.svelte',
			'detail/DetailBusRow.svelte',
			'detail/DetailEntityName.svelte',
		];
		const sources = files.map((file) => ({
			file,
			source: readFileSync(resolve(process.cwd(), `src/lib/features/map/${file}`), 'utf8'),
		}));
		expect(sources[0]!.source.split('\n').length).toBeLessThan(700);
		expect(
			sources.reduce((total, { source }) => total + source.split('\n').length, 0),
		).toBeLessThanOrEqual(1520);
		for (const { source } of sources) {
			expect(source).not.toMatch(/(?:max|min)-width:\s*(?:17|18)rem/);
			expect(source).not.toContain('--accent');
		}

		const fingerprints = sources.flatMap(({ file, source }) => {
			const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
			return [...css.matchAll(/\{([^{}]+)\}/g)].flatMap((match) => {
				const declaration = match[1]!
					.replace(/\/\*[\s\S]*?\*\//g, '')
					.split(';')
					.map((part) => part.replace(/\s+/g, ' ').trim())
					.filter((part) => part.includes(':'))
					.join(';');
				return declaration ? [`${declaration}::${file}`] : [];
			});
		});
		const declarationFiles = new Map<string, Set<string>>();
		for (const fingerprint of fingerprints) {
			const [declaration, file] = fingerprint.split('::');
			if (!declaration || !file) continue;
			const filesForDeclaration = declarationFiles.get(declaration) ?? new Set<string>();
			filesForDeclaration.add(file);
			declarationFiles.set(declaration, filesForDeclaration);
		}
		for (const filesForDeclaration of declarationFiles.values()) {
			expect(filesForDeclaration.size).toBe(1);
		}
	});

	it('pins every #16 family to a logical 2.75rem floor without adding tap-token usages', () => {
		const sources = {
			pills: readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/detail/DetailStatPills.svelte'),
				'utf8',
			),
			stop: readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/detail/DetailStopRow.svelte'),
				'utf8',
			),
			bus: readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/detail/DetailBusRow.svelte'),
				'utf8',
			),
			section: readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/detail/DetailSection.svelte'),
				'utf8',
			),
			detail: readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/MapSelectionDetail.svelte'),
				'utf8',
			),
		};

		for (const source of Object.values(sources)) expect(source).not.toContain('--size-tap-min');
		expect(sources.pills).toMatch(/\.detail-pill\)[\s\S]*min-block-size:\s*2\.75rem/);
		expect(sources.pills).toMatch(/::before[\s\S]*block-size:\s*2rem/);
		expect(sources.stop).toMatch(/\.detail-stop-row\s*\{[\s\S]*min-block-size:\s*2\.75rem/);
		expect(sources.bus).toMatch(/\.detail-bus-row\s*\{[\s\S]*min-block-size:\s*2\.75rem/);
		expect(sources.section).toMatch(
			/\.detail-section summary\s*\{[\s\S]*min-block-size:\s*2\.75rem/,
		);
		expect(sources.detail).toMatch(/\.map-departures button\s*\{[\s\S]*min-block-size:\s*2\.75rem/);
		expect(sources.detail).toMatch(
			/detail-schedule-tail[^}]*summary[^{]*\{[\s\S]*min-block-size:\s*2\.75rem/,
		);
	});

	it.each(['en', 'fr'] as const)(
		'inventories every visible %s detail target at 44px outside the APG separator',
		(locale) => {
			const style = document.createElement('style');
			style.textContent = DETAIL_TARGET_CSS_FILES.map(compiledCss).join('\n');
			document.head.append(style);
			const vehicle = resolveMapSelection(
				{ kind: 'vehicle', id: 'veh-1' },
				{ index, stops, alerts, routes },
			);
			const stop = resolveMapSelection(
				{ kind: 'stop', id: 'stop-1' },
				{ index, stops, alerts, stopFiles, now: new Date('2026-06-15T16:30:00Z') },
			);
			const route = resolveMapSelection(
				{ kind: 'route', id: '24' },
				{ index, stops, alerts, routes },
			);
			if (vehicle?.kind !== 'vehicle' || stop?.kind !== 'stop' || route?.kind !== 'route') {
				throw new Error('expected all three detail families');
			}
			const linkedAlert = {
				...alerts[0]!,
				url: 'https://example.test/a',
				url_en: 'https://example.test/a',
			};
			const stopWithBranches = {
				...stop,
				alerts: [linkedAlert],
				vehicles: [vehicles[0]!],
				departures: [
					...(stop.departures ?? []),
					{ route: '18', trip: 'trip-18-a', eta_utc: utc('2026-06-15T00:26:00Z'), delay_min: 0 },
					{ route: '80', trip: 'trip-80-a', eta_utc: utc('2026-06-15T00:36:00Z'), delay_min: 0 },
				],
			};
			const vehicleWithSummary = {
				...vehicle,
				pastStops: [vehicle.nextStops[0]!],
			};
			const observedFamilies = new Set<string>();
			const inventory = (container: HTMLElement) => {
				for (const target of container.querySelectorAll(
					'[data-slot="detail-body"] button, [data-slot="detail-body"] a[href], [data-slot="detail-body"] summary',
				)) {
					expectHard44(target);
				}
				for (const pill of container.querySelectorAll('.detail-pill')) expectHard44(pill);
				for (const [family, selector] of [
					['stat-pill', '.detail-pill'],
					['stop-row', '.detail-stop-row'],
					['bus-row', '.detail-bus-row'],
					['section-summary', '.detail-section > details > summary'],
					['alert-select', '.map-alert-button'],
					['alert-link', '.map-alert-link'],
					['departure-route', '[data-detail-focus-key$=":route"]'],
					['departure-trip', '[data-detail-focus-key$=":trip"]'],
					['schedule-tail', '[data-slot="detail-schedule-tail"] > summary'],
				] as const) {
					if (container.querySelector(selector)) observedFamilies.add(family);
				}
			};

			try {
				for (const detail of [vehicleWithSummary, stopWithBranches, route]) {
					const rendered = render(MapSelectionDetail, { props: { detail, locale } });
					inventory(rendered.container);
					rendered.unmount();
				}
				const failed = render(MapSelectionDetail, {
					props: {
						detail: vehicleWithSummary,
						locale,
						selectionPresence: 'missing-grace',
						selectionSourceHealth: 'failed',
						onrefresh: () => {},
					},
				});
				inventory(failed.container);
				expect(failed.container.querySelector('.detail-retry')).toBeInTheDocument();
				failed.unmount();
				expect([...observedFamilies].sort()).toEqual([
					'alert-link',
					'alert-select',
					'bus-row',
					'departure-route',
					'departure-trip',
					'schedule-tail',
					'section-summary',
					'stat-pill',
					'stop-row',
				]);
			} finally {
				style.remove();
			}
		},
	);
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

	it('uses the warm calm-caution family for degraded detail and a 44px retry target', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapSelectionDetail.svelte'),
			'utf8',
		);
		const cautionRule =
			source.match(/\.detail-source-state\[data-source-health\]\s*\{[\s\S]*?\}/)?.[0] ?? '';
		const retryRule = source.match(/\.detail-retry\s*\{[\s\S]*?\}/)?.[0] ?? '';

		const declarations = (rule: string) =>
			new Map(
				rule
					.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'))
					.split(';')
					.map((entry) => entry.trim())
					.filter(Boolean)
					.map((entry) => {
						const separator = entry.indexOf(':');
						return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
					}),
			);
		const cautionDeclarations = declarations(cautionRule);
		const retryDeclarations = declarations(retryRule);

		expect(cautionDeclarations.get('border-color')).toBe(
			'color-mix(in srgb, var(--dataviz-status-late) 38%, var(--border) 62%)',
		);
		expect(cautionDeclarations.get('background')).toBe(
			'color-mix(in srgb, var(--dataviz-status-late) 7%, var(--card) 86%)',
		);
		expect(cautionDeclarations.has('--accent')).toBe(false);
		expect(retryDeclarations.get('min-height')).toBe('2.75rem');
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

		expect(getByRole('button', { name: 'Select bus veh-1' })).toBeInTheDocument();
		expect(detailValue(container, 'Status')).toHaveTextContent('▲ Late');
		expect(detailValue(container, 'Crowding')).toHaveTextContent('▇ Standing');
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

		await fireEvent.click(getByRole('button', { name: 'Select bus veh-1' }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-1' });

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

	it('renders a per-bus not-reporting GPS note when the vehicle fix is stale', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);
		const { container, getByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en', notReporting: { ageS: 180 } },
		});

		// The honest caution note stays visible but is not a hover-driven live region.
		const note = container.querySelector('.map-not-reporting')!;
		expect(note).toBeInTheDocument();
		expect(note).not.toHaveAttribute('role');
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
		const { getByText, queryByRole } = render(MapSelectionDetail, {
			props: { detail, locale: 'fr', notReporting: { ageS: 180 } },
		});

		const note = getByText(/Pas de signal GPS/).closest('.map-not-reporting');
		expect(note).toHaveTextContent('Pas de signal GPS');
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

		expect(getByText('Stop code 52618')).toBeInTheDocument();
		expect(getAllByText('2 departures').length).toBeGreaterThan(0);
		expect(getByText('0 buses heading here')).toBeInTheDocument();
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

		await fireEvent.click(getByRole('button', { name: /^Select bus veh-1,/ }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'veh-1' });

		await fireEvent.click(getByRole('button', { name: /^Select bus veh-2,/ }));
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
		expect(getByText('2 buses visible')).toBeInTheDocument();
		expect(getByText('Stops')).toBeInTheDocument();
		expect(getByText('Sherbrooke / Saint-Denis')).toBeInTheDocument();
		expect(getByText('Mont-Royal / Saint-Laurent')).toBeInTheDocument();
		expect(getByText('Van Horne / Rockland')).toBeInTheDocument();
		expect(
			getByRole('button', { name: 'Select alert Route 24 is diverted via Pine & Clark.' }),
		).toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: /Select stop Van Horne \/ Rockland,/ }));
		expect(onselect).toHaveBeenCalledWith({ kind: 'stop', id: 'stop-3' });

		await fireEvent.click(getByRole('button', { name: /^Select bus veh-1,/ }));
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
		const absent = [
			...container.querySelectorAll('.map-detail-grid [data-slot="absent-value"]'),
		].find((node) => node.textContent?.includes('this vehicle is not reporting'));
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
});
