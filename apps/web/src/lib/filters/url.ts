import type { FilterState, IdSetKey } from './state';
import {
	emptyFilterState,
	normalizeStatus,
	normalizeOccupancy,
	normalizeEntities,
	normalizeAlerts,
	normalizeWindow,
	normalizeWorstN,
	normalizeAlertAffects,
	normalizeSeverity,
	isGrain,
	isIsoDate,
} from './state';

const KEY_ORDER = [
	'route',
	'stop',
	'trip',
	'vehicle',
	'status',
	'occupancy',
	'entity',
	'alert',
	'grain',
	'from',
	'to',
	'date',
	'n',
	'affects',
	'severity',
] as const;

export const FILTER_SEARCH_PARAM_KEYS = Object.freeze(KEY_ORDER);

const SET_KEY_TO_FIELD: Record<'route' | 'stop' | 'trip' | 'vehicle', IdSetKey> = {
	route: 'routes',
	stop: 'stops',
	trip: 'trips',
	vehicle: 'vehicles',
};

function splitTokens(raw: string): string[] {
	return raw
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

function collect(sp: URLSearchParams, key: string): string[] {
	const out: string[] = [];
	for (const raw of sp.getAll(key)) out.push(...splitTokens(raw));
	return out;
}

function dedupe(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		if (!seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out;
}

export function fromSearchParams(sp: URLSearchParams): FilterState {
	const state = emptyFilterState();

	for (const [key, field] of Object.entries(SET_KEY_TO_FIELD) as [
		'route' | 'stop' | 'trip' | 'vehicle',
		IdSetKey,
	][]) {
		for (const token of collect(sp, key)) state[field].add(token);
	}

	const status = normalizeStatus(collect(sp, 'status'));
	if (status) state.status = status;

	const occupancy = normalizeOccupancy(collect(sp, 'occupancy'));
	if (occupancy) state.occupancy = occupancy;

	const entities = normalizeEntities(collect(sp, 'entity'));
	if (entities) state.entities = entities;

	const alerts = normalizeAlerts(collect(sp, 'alert'));
	if (alerts) state.alerts = alerts;

	const grainTokens = dedupe(collect(sp, 'grain'));
	const grain = grainTokens.find((g) => isGrain(g));
	if (grain && isGrain(grain)) state.grain = grain;

	const window = normalizeWindow(sp.get('from'), sp.get('to'));
	if (window) state.window = window;

	const date = sp.get('date');
	if (isIsoDate(date)) state.date = date;

	const worstN = normalizeWorstN(sp.get('n'));
	if (worstN) state.worstN = worstN;

	const alertAffects = normalizeAlertAffects(sp.get('affects'));
	if (alertAffects) state.alertAffects = alertAffects;

	const alertSeverity = normalizeSeverity(sp.get('severity'));
	if (alertSeverity) state.alertSeverity = alertSeverity;

	return state;
}

export function toSearchParams(s: FilterState): URLSearchParams {
	const sp = new URLSearchParams();

	for (const key of KEY_ORDER) {
		switch (key) {
			case 'route':
			case 'stop':
			case 'trip':
			case 'vehicle': {
				const set = s[SET_KEY_TO_FIELD[key]];
				if (set.size > 0) sp.set(key, [...set].sort().join(','));
				break;
			}
			case 'status': {
				if (s.status && s.status.length > 0) sp.set('status', s.status.join(','));
				break;
			}
			case 'occupancy': {
				if (s.occupancy && s.occupancy.length > 0) sp.set('occupancy', s.occupancy.join(','));
				break;
			}
			case 'entity': {
				if (s.entities && s.entities.length > 0) sp.set('entity', s.entities.join(','));
				break;
			}
			case 'alert': {
				if (s.alerts && s.alerts.length > 0) sp.set('alert', s.alerts.join(','));
				break;
			}
			case 'grain': {
				if (s.grain !== undefined) sp.set('grain', s.grain);
				break;
			}
			case 'from': {
				if (s.window) sp.set('from', s.window.from);
				break;
			}
			case 'to': {
				if (s.window) sp.set('to', s.window.to);
				break;
			}
			case 'date': {
				if (s.date !== undefined) sp.set('date', s.date);
				break;
			}
			case 'n': {
				if (s.worstN !== undefined) sp.set('n', s.worstN);
				break;
			}
			case 'affects': {
				if (s.alertAffects !== undefined) sp.set('affects', s.alertAffects);
				break;
			}
			case 'severity': {
				if (s.alertSeverity !== undefined) sp.set('severity', s.alertSeverity);
				break;
			}
		}
	}

	return sp;
}

export function toSearchString(s: FilterState): string {
	return toSearchParams(s).toString();
}
