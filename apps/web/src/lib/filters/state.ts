import type { StatusCode, OccupancyCode, SeverityCode, Grain } from '$lib/v1/schemas/types';
import { STATUS_CODES, OCCUPANCY_CODES, SEVERITY_CODES, GRAINS } from '$lib/v1/schemas/types';
import type { DateWindow } from '$lib/v1/history/window';

export type { DateWindow } from '$lib/v1/history/window';

export const ENTITY_KINDS = ['bus', 'stop'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const ALERT_ENTITY_KINDS = ['has_alert'] as const;
export type AlertEntityKind = (typeof ALERT_ENTITY_KINDS)[number];

export const ALERT_AFFECTS = ['lines', 'stops'] as const;
export type AlertAffects = (typeof ALERT_AFFECTS)[number];

export function isIsoDate(v: string | null | undefined): v is string {
	return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function normalizeWindow(
	from: string | null | undefined,
	to: string | null | undefined,
): DateWindow | undefined {
	if (!isIsoDate(from) || !isIsoDate(to)) return undefined;
	return from <= to ? { from, to } : { from: to, to: from };
}

export interface FilterState {
	routes: Set<string>;
	stops: Set<string>;
	trips: Set<string>;
	vehicles: Set<string>;
	status?: StatusCode[];
	occupancy?: OccupancyCode[];
	entities?: EntityKind[];
	alerts?: AlertEntityKind[];
	grain?: Grain;
	window?: DateWindow;
	date?: string;
	worstN?: WorstN;
	alertAffects?: AlertAffects;
	alertSeverity?: SeverityCode;
}

export const WORST_N_LADDER = ['5', '10', '20', '30', '50'] as const;
export type WorstNRung = (typeof WORST_N_LADDER)[number];
export type WorstN = WorstNRung | 'all';

const WORST_N_SET: ReadonlySet<string> = new Set([...WORST_N_LADDER, 'all']);

export function isWorstN(v: string): v is WorstN {
	return WORST_N_SET.has(v);
}

export function normalizeWorstN(v: string | null | undefined): WorstN | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return isWorstN(t) ? t : undefined;
}

export { STATUS_CODES, OCCUPANCY_CODES, SEVERITY_CODES, GRAINS };

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_CODES);
const OCCUPANCY_SET: ReadonlySet<string> = new Set(OCCUPANCY_CODES);
const SEVERITY_SET: ReadonlySet<string> = new Set(SEVERITY_CODES);
const GRAIN_SET: ReadonlySet<string> = new Set(GRAINS);
const ENTITY_SET: ReadonlySet<string> = new Set(ENTITY_KINDS);
const ALERT_ENTITY_SET: ReadonlySet<string> = new Set(ALERT_ENTITY_KINDS);
const ALERT_AFFECTS_SET: ReadonlySet<string> = new Set(ALERT_AFFECTS);

export function isStatusCode(v: string): v is StatusCode {
	return STATUS_SET.has(v);
}

export function isOccupancyCode(v: string): v is OccupancyCode {
	return OCCUPANCY_SET.has(v);
}

export function isEntityKind(v: string): v is EntityKind {
	return ENTITY_SET.has(v);
}

export function isAlertEntityKind(v: string): v is AlertEntityKind {
	return ALERT_ENTITY_SET.has(v);
}

export function isAlertAffects(v: string): v is AlertAffects {
	return ALERT_AFFECTS_SET.has(v);
}

export function isSeverityCode(v: string): v is SeverityCode {
	return SEVERITY_SET.has(v);
}

export function normalizeAlertAffects(v: string | null | undefined): AlertAffects | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return isAlertAffects(t) ? t : undefined;
}

export function normalizeSeverity(v: string | null | undefined): SeverityCode | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return isSeverityCode(t) ? t : undefined;
}

export function isGrain(v: string): v is Grain {
	return GRAIN_SET.has(v);
}

export function normalizeStatus(values: readonly string[]): StatusCode[] | undefined {
	const out: StatusCode[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isStatusCode(v) && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : undefined;
}

export function normalizeOccupancy(values: readonly string[]): OccupancyCode[] | undefined {
	const out: OccupancyCode[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isOccupancyCode(v) && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : undefined;
}

export function normalizeEntities(values: readonly string[]): EntityKind[] | undefined {
	const out: EntityKind[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isEntityKind(v) && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : undefined;
}

export function normalizeAlerts(values: readonly string[]): AlertEntityKind[] | undefined {
	const out: AlertEntityKind[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isAlertEntityKind(v) && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : undefined;
}

export function emptyFilterState(): FilterState {
	return {
		routes: new Set<string>(),
		stops: new Set<string>(),
		trips: new Set<string>(),
		vehicles: new Set<string>(),
	};
}

export function cloneFilterState(s: FilterState): FilterState {
	return {
		routes: new Set(s.routes),
		stops: new Set(s.stops),
		trips: new Set(s.trips),
		vehicles: new Set(s.vehicles ?? []),
		...(s.status ? { status: s.status.slice() } : {}),
		...(s.occupancy ? { occupancy: s.occupancy.slice() } : {}),
		...(s.entities ? { entities: s.entities.slice() } : {}),
		...(s.alerts ? { alerts: s.alerts.slice() } : {}),
		...(s.grain !== undefined ? { grain: s.grain } : {}),
		...(s.window !== undefined ? { window: { from: s.window.from, to: s.window.to } } : {}),
		...(s.date !== undefined ? { date: s.date } : {}),
		...(s.worstN !== undefined ? { worstN: s.worstN } : {}),
		...(s.alertAffects !== undefined ? { alertAffects: s.alertAffects } : {}),
		...(s.alertSeverity !== undefined ? { alertSeverity: s.alertSeverity } : {}),
	};
}

export type IdSetKey = 'routes' | 'stops' | 'trips' | 'vehicles';

export function addToSet(s: FilterState, key: IdSetKey, value: string): FilterState {
	const v = value.trim();
	const next = cloneFilterState(s);
	if (v) next[key].add(v);
	return next;
}

export function removeFromSet(s: FilterState, key: IdSetKey, value: string): FilterState {
	const next = cloneFilterState(s);
	next[key].delete(value.trim());
	return next;
}

export function clear(_s?: FilterState): FilterState {
	return emptyFilterState();
}

export function isEmptyFilterState(s: FilterState): boolean {
	return (
		s.routes.size === 0 &&
		s.stops.size === 0 &&
		s.trips.size === 0 &&
		(s.vehicles?.size ?? 0) === 0 &&
		(s.status === undefined || s.status.length === 0) &&
		(s.occupancy === undefined || s.occupancy.length === 0) &&
		(s.entities === undefined || s.entities.length === 0) &&
		(s.alerts === undefined || s.alerts.length === 0) &&
		s.grain === undefined &&
		s.window === undefined &&
		s.date === undefined &&
		s.worstN === undefined &&
		s.alertAffects === undefined &&
		s.alertSeverity === undefined
	);
}
