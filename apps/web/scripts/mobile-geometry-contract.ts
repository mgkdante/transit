export const MOBILE_GEOMETRY_VIEWPORT = {
	width: 390,
	height: 844,
	deviceScaleFactor: 1,
	mobile: true,
	touch: true,
	colorScheme: 'dark',
} as const;

export const MOBILE_GEOMETRY_ROUTES = [
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
] as const;

export type MobileGeometryRoute = (typeof MOBILE_GEOMETRY_ROUTES)[number];
export type MobileGeometryRouteId = MobileGeometryRoute['id'];

export const MOBILE_REQUIRED_EVIDENCE = {
	chartOrScrollFrame: [
		'hotspots',
		'repeat-offenders',
		'line-24-reliability',
		'stop-52095-reliability',
		'network',
	],
	schedule: ['line-24-schedule', 'stop-52095-schedule'],
	map: ['map'],
} as const satisfies {
	chartOrScrollFrame: readonly MobileGeometryRouteId[];
	schedule: readonly MobileGeometryRouteId[];
	map: readonly MobileGeometryRouteId[];
};

export interface GeometryRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

export interface ChartGeometry {
	label: string;
	layout: string;
	visible: boolean;
	output: GeometryRect;
	viewport: GeometryRect;
	canvas: GeometryRect;
	clientWidth: number;
	scrollWidth: number;
	overflowX: string;
	role: string | null;
	tabIndex: number | null;
}

export interface ScrollFrameGeometry {
	label: string;
	visible: boolean;
	frame: GeometryRect;
	viewport: GeometryRect;
	clientWidth: number;
	scrollWidth: number;
	overflowX: string;
	role: string | null;
	tabIndex: number | null;
}

export interface ScheduleGeometry {
	label: string;
	visible: boolean;
	frame: GeometryRect;
	clientWidth: number;
	scrollWidth: number;
	tableWidth: number;
	overflowX: string;
}

export interface MapGeometry {
	stage: GeometryRect;
	attribution: GeometryRect;
	expanded: boolean;
	controls: GeometryRect[];
}

export interface MobileRouteGeometry {
	routeId: MobileGeometryRouteId;
	path: string;
	viewportWidth: number;
	documents: {
		html: number;
		body: number;
		main: number | null;
	};
	charts: ChartGeometry[];
	scrollFrames: ScrollFrameGeometry[];
	schedules: ScheduleGeometry[];
	map: MapGeometry | null;
}

export const MOBILE_INTERACTION_IDS = [
	'line-heatmap',
	'stop-heatmap',
	'hotspots-chart',
	'repeat-offenders-chart',
	'network-chart',
] as const;

export type MobileInteractionId = (typeof MOBILE_INTERACTION_IDS)[number];

export interface MobileInteractionResult {
	id: string;
	found: boolean;
	expandedBefore: boolean;
	expandedAfterChart: boolean;
	expandedAfterOutside: boolean;
}

export interface MobileGeometryRun {
	routes: MobileRouteGeometry[];
	interactions: MobileInteractionResult[];
}

const ROUTE_BY_ID = new Map<string, MobileGeometryRoute>(
	MOBILE_GEOMETRY_ROUTES.map((route) => [route.id, route]),
);
const OVERFLOW_EPSILON_PX = 1;
const SCHEDULE_READABLE_MIN_WIDTH_PX = 500;

function routeLabel(route: MobileRouteGeometry): string {
	return ROUTE_BY_ID.get(route.routeId)?.label ?? route.routeId;
}

function escapesHorizontalViewport(rect: GeometryRect, viewportWidth: number): boolean {
	return rect.left < -OVERFLOW_EPSILON_PX || rect.right > viewportWidth + OVERFLOW_EPSILON_PX;
}

function isScrollableOverflow(value: string): boolean {
	return value === 'auto' || value === 'scroll';
}

function rectContains(container: GeometryRect, child: GeometryRect): boolean {
	return (
		child.left >= container.left - OVERFLOW_EPSILON_PX &&
		child.right <= container.right + OVERFLOW_EPSILON_PX &&
		child.top >= container.top - OVERFLOW_EPSILON_PX &&
		child.bottom <= container.bottom + OVERFLOW_EPSILON_PX
	);
}

function rectsOverlap(a: GeometryRect, b: GeometryRect): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function validateScrollSemantics(
	prefix: string,
	clientWidth: number,
	scrollWidth: number,
	overflowX: string,
	role: string | null,
	tabIndex: number | null,
): string[] {
	const errors: string[] = [];
	const scrolls = scrollWidth - clientWidth > OVERFLOW_EPSILON_PX;
	if (scrolls) {
		if (!isScrollableOverflow(overflowX)) {
			errors.push(`${prefix} overflows without an auto/scroll chart viewport`);
		}
		if (role !== 'region') errors.push(`${prefix} overflows without role="region"`);
		if (tabIndex !== 0) errors.push(`${prefix} overflows without tabindex="0"`);
	} else if (role !== null || tabIndex !== null) {
		errors.push(`${prefix} fits but advertises a scroll region`);
	}
	return errors;
}

export function validateMobileRouteGeometry(route: MobileRouteGeometry): string[] {
	const label = routeLabel(route);
	const errors: string[] = [];
	for (const [documentName, width] of Object.entries(route.documents)) {
		if (width == null) {
			errors.push(`${label}: ${documentName} landmark was not found`);
		} else if (width - route.viewportWidth > OVERFLOW_EPSILON_PX) {
			errors.push(
				`${label}: ${documentName} width ${Math.round(width)}px exceeds the ${route.viewportWidth}px viewport`,
			);
		}
	}

	for (const chart of route.charts) {
		if (!chart.visible) continue;
		const prefix = `${label}: ${chart.label}`;
		if (
			chart.output.width <= 0 ||
			chart.output.height <= 0 ||
			chart.viewport.width <= 0 ||
			chart.viewport.height <= 0
		) {
			errors.push(`${prefix} has non-positive visible geometry`);
		}
		if (escapesHorizontalViewport(chart.viewport, route.viewportWidth)) {
			errors.push(`${prefix} viewport escapes the horizontal viewport`);
		}
		errors.push(
			...validateScrollSemantics(
				prefix,
				chart.clientWidth,
				chart.scrollWidth,
				chart.overflowX,
				chart.role,
				chart.tabIndex,
			),
		);
	}

	for (const frame of route.scrollFrames) {
		if (!frame.visible) continue;
		const prefix = `${label}: ${frame.label}`;
		if (frame.frame.width <= 0 || frame.frame.height <= 0 || frame.viewport.height <= 0) {
			errors.push(`${prefix} has non-positive visible geometry`);
		}
		if (
			escapesHorizontalViewport(frame.frame, route.viewportWidth) ||
			escapesHorizontalViewport(frame.viewport, route.viewportWidth)
		) {
			errors.push(`${prefix} viewport escapes the horizontal viewport`);
		}
		errors.push(
			...validateScrollSemantics(
				prefix,
				frame.clientWidth,
				frame.scrollWidth,
				frame.overflowX,
				frame.role,
				frame.tabIndex,
			),
		);
	}

	for (const schedule of route.schedules) {
		if (!schedule.visible) continue;
		const prefix = `${label}: ${schedule.label}`;
		if (escapesHorizontalViewport(schedule.frame, route.viewportWidth)) {
			errors.push(`${prefix} frame escapes the horizontal viewport`);
		}
		if (schedule.tableWidth < SCHEDULE_READABLE_MIN_WIDTH_PX) {
			errors.push(`${prefix} does not preserve a 500px readable table width`);
		}
		if (!isScrollableOverflow(schedule.overflowX) || schedule.scrollWidth <= schedule.clientWidth) {
			errors.push(`${prefix} does not own horizontal scrolling`);
		}
	}

	if (route.map?.expanded) {
		if (!rectContains(route.map.stage, route.map.attribution)) {
			errors.push(`${label}: expanded attribution escapes the map stage`);
		}
		if (route.map.controls.some((control) => rectsOverlap(route.map!.attribution, control))) {
			errors.push(`${label}: expanded attribution overlaps a mobile map control`);
		}
	}

	return errors;
}

export function validateMobileGeometryRun(run: MobileGeometryRun): string[] {
	const errors = run.routes.flatMap(validateMobileRouteGeometry);
	for (const expected of MOBILE_GEOMETRY_ROUTES) {
		const matches = run.routes.filter((route) => route.routeId === expected.id);
		if (matches.length === 0) {
			errors.push(`Mobile matrix is missing route: ${expected.label} (${expected.path})`);
		} else if (matches.length > 1) {
			errors.push(`Mobile matrix repeats route: ${expected.label} (${expected.path})`);
		}
	}

	for (const id of MOBILE_REQUIRED_EVIDENCE.chartOrScrollFrame) {
		const route = run.routes.find((candidate) => candidate.routeId === id);
		if (!route) continue;
		if (
			!route.charts.some((chart) => chart.visible) &&
			!route.scrollFrames.some((frame) => frame.visible)
		) {
			errors.push(
				`${routeLabel(route)}: required shared chart or frozen-gutter frame was not found`,
			);
		}
	}
	for (const id of MOBILE_REQUIRED_EVIDENCE.schedule) {
		const route = run.routes.find((candidate) => candidate.routeId === id);
		if (route && !route.schedules.some((schedule) => schedule.visible)) {
			errors.push(`${routeLabel(route)}: required schedule table frame was not found`);
		}
	}
	for (const id of MOBILE_REQUIRED_EVIDENCE.map) {
		const route = run.routes.find((candidate) => candidate.routeId === id);
		if (route && (!route.map || !route.map.expanded)) {
			errors.push(`${routeLabel(route)}: expanded map attribution evidence was not found`);
		}
	}

	for (const id of MOBILE_INTERACTION_IDS) {
		const result = run.interactions.find((interaction) => interaction.id === id);
		if (!result) {
			errors.push(`Mobile interaction matrix is missing: ${id}`);
			continue;
		}
		if (!result.found) errors.push(`${id}: chart or containing collapsible card was not found`);
		if (!result.expandedBefore) errors.push(`${id}: card was not expanded before the probe`);
		if (!result.expandedAfterChart) errors.push(`${id}: chart interaction collapsed its card`);
		if (result.expandedAfterOutside)
			errors.push(`${id}: outside card interaction did not collapse`);
	}
	return errors;
}
