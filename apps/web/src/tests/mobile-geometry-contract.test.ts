import { describe, expect, it } from 'vitest';
import {
	MOBILE_GEOMETRY_ROUTES,
	MOBILE_GEOMETRY_VIEWPORT,
	MOBILE_REQUIRED_EVIDENCE,
	type MobileRouteGeometry,
	validateMobileGeometryRun,
	validateMobileRouteGeometry,
} from '../../scripts/mobile-geometry-contract';
import {
	buildChromeLaunchArgs,
	isMobileGeometryInitialPageReady,
	MOBILE_CARD_OUTSIDE_PROBE_SELECTORS,
	resolveMobileGeometryBaseUrl,
	selectChromePageTarget,
} from '../../scripts/mobile-geometry-runner';

const rect = (left = 12, width = 366, top = 100, height = 180) => ({
	left,
	right: left + width,
	top,
	bottom: top + height,
	width,
	height,
});

const cleanRoute = (overrides: Partial<MobileRouteGeometry> = {}): MobileRouteGeometry => ({
	routeId: 'home',
	path: '/',
	viewportWidth: 390,
	documents: { html: 390, body: 390, main: 390 },
	charts: [],
	scrollFrames: [],
	schedules: [],
	map: null,
	...overrides,
});

const containedChart = () => ({
	label: 'Shared chart',
	layout: 'fluid',
	visible: true,
	output: rect(),
	viewport: rect(),
	canvas: rect(),
	clientWidth: 366,
	scrollWidth: 366,
	overflowX: 'visible',
	role: null,
	tabIndex: null,
});

describe('mobile geometry browser contract', () => {
	it('locks the exact 390x844 touch and dark viewport', () => {
		expect(MOBILE_GEOMETRY_VIEWPORT).toEqual({
			width: 390,
			height: 844,
			deviceScaleFactor: 1,
			mobile: true,
			touch: true,
			colorScheme: 'dark',
		});
	});

	it('falls back to the disclosure trigger when a card has no subtitle surface', () => {
		expect(MOBILE_CARD_OUTSIDE_PROBE_SELECTORS).toEqual([
			'.section-subtitle--article-summary',
			'[data-section-trigger]',
		]);
	});

	it('waits for the BASE_URL document to commit before matrix navigation', () => {
		expect(
			isMobileGeometryInitialPageReady(
				{ href: 'about:blank', readyState: 'complete' },
				'http://127.0.0.1:5177',
			),
		).toBe(false);
		expect(
			isMobileGeometryInitialPageReady(
				{ href: 'http://127.0.0.1:5177/', readyState: 'loading' },
				'http://127.0.0.1:5177',
			),
		).toBe(false);
		expect(
			isMobileGeometryInitialPageReady(
				{ href: 'http://127.0.0.1:5177/', readyState: 'complete' },
				'http://127.0.0.1:5177',
			),
		).toBe(true);
	});

	it('attaches to the BASE_URL target instead of a stale about:blank page', () => {
		expect(
			selectChromePageTarget(
				[
					{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://blank' },
					{
						type: 'page',
						url: 'http://127.0.0.1:5177/',
						webSocketDebuggerUrl: 'ws://transit',
					},
				],
				'http://127.0.0.1:5177',
			),
		).toBe('ws://transit');
	});

	it('enumerates every named citizen surface and detail tab once', () => {
		expect(MOBILE_GEOMETRY_ROUTES).toEqual([
			{ id: 'home', label: 'Home', path: '/' },
			{ id: 'status', label: 'Status', path: '/status' },
			{ id: 'hotspots', label: 'Hotspots', path: '/hotspots' },
			{ id: 'receipt', label: 'Receipt', path: '/receipt' },
			{ id: 'repeat-offenders', label: 'Repeat Offenders', path: '/repeat-offenders' },
			{ id: 'alerts', label: 'Alerts', path: '/alerts' },
			{ id: 'lines', label: 'Lines listing', path: '/lines' },
			{ id: 'line-24-detail', label: 'Line 24 detail', path: '/lines/24?tab=detail' },
			{ id: 'line-24-schedule', label: 'Line 24 schedule', path: '/lines/24?tab=schedule' },
			{
				id: 'line-24-reliability',
				label: 'Line 24 reliability',
				path: '/lines/24?tab=reliability',
			},
			{ id: 'stops', label: 'Stops listing', path: '/stops' },
			{ id: 'stop-52095-detail', label: 'Stop 52095 detail', path: '/stop/52095?tab=detail' },
			{
				id: 'stop-52095-schedule',
				label: 'Stop 52095 schedule',
				path: '/stop/52095?tab=schedule',
			},
			{
				id: 'stop-52095-reliability',
				label: 'Stop 52095 reliability',
				path: '/stop/52095?tab=reliability',
			},
			{ id: 'network', label: 'Network', path: '/network' },
			{ id: 'metrics', label: 'Metrics', path: '/metrics' },
			{ id: 'map', label: 'Map', path: '/map' },
			{ id: 'search', label: 'Search', path: '/search' },
		]);
		expect(new Set(MOBILE_GEOMETRY_ROUTES.map(({ id }) => id)).size).toBe(
			MOBILE_GEOMETRY_ROUTES.length,
		);
		expect(new Set(MOBILE_GEOMETRY_ROUTES.map(({ path }) => path)).size).toBe(
			MOBILE_GEOMETRY_ROUTES.length,
		);
	});

	it('requires durable evidence from chart, schedule, and map-bearing routes', () => {
		expect(MOBILE_REQUIRED_EVIDENCE).toEqual({
			chartOrScrollFrame: [
				'hotspots',
				'repeat-offenders',
				'line-24-reliability',
				'stop-52095-reliability',
				'network',
			],
			schedule: ['line-24-schedule', 'stop-52095-schedule'],
			map: ['map'],
		});
	});

	it('defaults to 5177, refuses 5174, and launches Chrome with an isolated dynamic-debug profile', () => {
		expect(resolveMobileGeometryBaseUrl(undefined)).toBe('http://127.0.0.1:5177');
		expect(resolveMobileGeometryBaseUrl('http://localhost:4173/')).toBe('http://localhost:4173');
		expect(() => resolveMobileGeometryBaseUrl('http://127.0.0.1:5174')).toThrow(
			'Port 5174 is reserved and must not be touched by the mobile geometry harness',
		);

		const args = buildChromeLaunchArgs(
			'/tmp/transit-mobile-geometry-test',
			'http://127.0.0.1:5177',
		);
		expect(args).toEqual(
			expect.arrayContaining([
				'--headless=new',
				'--remote-debugging-port=0',
				'--user-data-dir=/tmp/transit-mobile-geometry-test',
				'--window-size=390,844',
			]),
		);
		expect(args.join(' ')).not.toContain('5174');
		expect(args).not.toContain('--disable-gpu');
		expect(args.at(-1)).toBe('http://127.0.0.1:5177');
	});

	it('accepts contained positive shared-chart geometry', () => {
		const route = cleanRoute({
			charts: [{ ...containedChart(), label: 'On-time trend' }],
		});

		expect(validateMobileRouteGeometry(route)).toEqual([]);
	});

	it('rejects page overflow, zero-sized charts, and chart viewports outside the page', () => {
		const route = cleanRoute({
			documents: { html: 430, body: 425, main: 420 },
			charts: [
				{
					label: 'Broken chart',
					layout: 'fluid',
					visible: true,
					output: rect(12, 0, 100, 0),
					viewport: rect(-8, 410),
					canvas: rect(-8, 410),
					clientWidth: 410,
					scrollWidth: 410,
					overflowX: 'visible',
					role: null,
					tabIndex: null,
				},
			],
		});

		expect(validateMobileRouteGeometry(route)).toEqual(
			expect.arrayContaining([
				'Home: html width 430px exceeds the 390px viewport',
				'Home: body width 425px exceeds the 390px viewport',
				'Home: main width 420px exceeds the 390px viewport',
				'Home: Broken chart has non-positive visible geometry',
				'Home: Broken chart viewport escapes the horizontal viewport',
			]),
		);
	});

	it('requires real dense overflow to be chart-only and keyboard reachable', () => {
		const base = {
			label: 'Dense chart',
			layout: 'dense',
			visible: true,
			output: rect(),
			viewport: rect(),
			canvas: rect(12, 768),
			clientWidth: 366,
			scrollWidth: 768,
			overflowX: 'auto',
			role: 'region',
			tabIndex: 0,
		} as const;
		expect(validateMobileRouteGeometry(cleanRoute({ charts: [base] }))).toEqual([]);

		expect(
			validateMobileRouteGeometry(
				cleanRoute({
					charts: [{ ...base, role: null, tabIndex: null, overflowX: 'visible' }],
				}),
			),
		).toEqual(
			expect.arrayContaining([
				'Home: Dense chart overflows without an auto/scroll chart viewport',
				'Home: Dense chart overflows without role="region"',
				'Home: Dense chart overflows without tabindex="0"',
			]),
		);
	});

	it('keeps fitting chart and frozen-gutter viewports out of the tab order', () => {
		const route = cleanRoute({
			charts: [
				{
					label: 'Fitting dense chart',
					layout: 'dense',
					visible: true,
					output: rect(),
					viewport: rect(),
					canvas: rect(),
					clientWidth: 366,
					scrollWidth: 366,
					overflowX: 'auto',
					role: 'region',
					tabIndex: 0,
				},
			],
			scrollFrames: [
				{
					label: 'Fitting heatmap',
					visible: true,
					frame: rect(),
					viewport: rect(72, 306),
					clientWidth: 306,
					scrollWidth: 306,
					overflowX: 'auto',
					role: 'region',
					tabIndex: 0,
				},
			],
		});

		expect(validateMobileRouteGeometry(route)).toEqual(
			expect.arrayContaining([
				'Home: Fitting dense chart fits but advertises a scroll region',
				'Home: Fitting heatmap fits but advertises a scroll region',
			]),
		);
	});

	it('requires mobile schedule tables to keep their wide table inside an internal frame', () => {
		const valid = cleanRoute({
			routeId: 'line-24-schedule',
			path: '/lines/24?tab=schedule',
			schedules: [
				{
					label: 'Line schedule',
					visible: true,
					frame: rect(),
					clientWidth: 366,
					scrollWidth: 512,
					tableWidth: 512,
					overflowX: 'auto',
				},
			],
		});
		expect(validateMobileRouteGeometry(valid)).toEqual([]);

		const broken = structuredClone(valid);
		broken.schedules[0] = {
			...broken.schedules[0],
			frame: rect(-10, 430),
			tableWidth: 420,
			overflowX: 'visible',
		};
		expect(validateMobileRouteGeometry(broken)).toEqual(
			expect.arrayContaining([
				'Line 24 schedule: Line schedule frame escapes the horizontal viewport',
				'Line 24 schedule: Line schedule does not preserve a 500px readable table width',
				'Line 24 schedule: Line schedule does not own horizontal scrolling',
			]),
		);
	});

	it('requires expanded map attribution to stay in-stage and clear mobile controls', () => {
		const valid = cleanRoute({
			routeId: 'map',
			path: '/map',
			map: {
				stage: rect(0, 390, 80, 680),
				attribution: rect(12, 240, 650, 72),
				expanded: true,
				controls: [rect(270, 108, 590, 48), rect(310, 52, 520, 52)],
			},
		});
		expect(validateMobileRouteGeometry(valid)).toEqual([]);

		const broken = structuredClone(valid);
		broken.map = {
			stage: rect(0, 390, 80, 680),
			attribution: rect(250, 180, 590, 80),
			expanded: true,
			controls: [rect(270, 108, 610, 48)],
		};
		expect(validateMobileRouteGeometry(broken)).toEqual(
			expect.arrayContaining([
				'Map: expanded attribution escapes the map stage',
				'Map: expanded attribution overlaps a mobile map control',
			]),
		);
	});

	it('requires a complete route matrix and all five non-collapsing interaction probes', () => {
		const routes = MOBILE_GEOMETRY_ROUTES.map((route) => {
			const snapshot = cleanRoute({ routeId: route.id, path: route.path });
			if (MOBILE_REQUIRED_EVIDENCE.chartOrScrollFrame.includes(route.id as never)) {
				snapshot.charts = [containedChart()];
			}
			if (MOBILE_REQUIRED_EVIDENCE.schedule.includes(route.id as never)) {
				snapshot.schedules = [
					{
						label: 'Schedule',
						visible: true,
						frame: rect(),
						clientWidth: 366,
						scrollWidth: 512,
						tableWidth: 512,
						overflowX: 'auto',
					},
				];
			}
			if (MOBILE_REQUIRED_EVIDENCE.map.includes(route.id as never)) {
				snapshot.map = {
					stage: rect(0, 390, 80, 680),
					attribution: rect(12, 240, 650, 72),
					expanded: true,
					controls: [],
				};
			}
			return snapshot;
		});
		const interactions = [
			'line-heatmap',
			'stop-heatmap',
			'hotspots-chart',
			'repeat-offenders-chart',
			'network-chart',
		].map((id) => ({
			id,
			found: true,
			expandedBefore: true,
			expandedAfterChart: true,
			expandedAfterOutside: false,
		}));

		expect(validateMobileGeometryRun({ routes, interactions })).toEqual([]);
		expect(
			validateMobileGeometryRun({
				routes: routes.slice(1),
				interactions: interactions.slice(1),
			}),
		).toEqual(
			expect.arrayContaining([
				'Mobile matrix is missing route: Home (/)',
				'Mobile interaction matrix is missing: line-heatmap',
			]),
		);

		const missingEvidence = structuredClone(routes);
		missingEvidence.find(({ routeId }) => routeId === 'network')!.charts = [];
		missingEvidence.find(({ routeId }) => routeId === 'line-24-schedule')!.schedules = [];
		missingEvidence.find(({ routeId }) => routeId === 'map')!.map = null;
		expect(validateMobileGeometryRun({ routes: missingEvidence, interactions })).toEqual(
			expect.arrayContaining([
				'Network: required shared chart or frozen-gutter frame was not found',
				'Line 24 schedule: required schedule table frame was not found',
				'Map: expanded map attribution evidence was not found',
			]),
		);
	});
});
