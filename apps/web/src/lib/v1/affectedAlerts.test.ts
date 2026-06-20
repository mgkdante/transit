import { describe, expect, it } from 'vitest';
import type { Alert } from './schemas';
import { alertsForRoute, alertsForStop } from './affectedAlerts';

// A small, hand-built alert set covering the keying cases:
//   a1 — scoped to stop S1 only (stops[]), no routes.
//   a2 — scoped to route R1 only (routes[]), no stops.
//   a3 — scoped to a different route R9 + a different stop S9 (must NOT match S1/R1).
//   a4 — scoped to BOTH route R1 and stop S2.
const ALERTS = [
	{ id: 'a1', severity: 'high', header_key: 'A1', stops: ['S1'] },
	{ id: 'a2', severity: 'critical', header_key: 'A2', routes: ['R1'] },
	{ id: 'a3', severity: 'watch', header_key: 'A3', routes: ['R9'], stops: ['S9'] },
	{ id: 'a4', severity: 'high', header_key: 'A4', routes: ['R1'], stops: ['S2'] },
] as unknown as Alert[];

describe('alertsForRoute', () => {
	it('returns alerts whose routes[] lists the route id, severity-first', () => {
		// a2 (critical) ranks ahead of a4 (high).
		const out = alertsForRoute(ALERTS, 'R1');
		expect(out.map((a) => a.id)).toEqual(['a2', 'a4']);
	});

	it('does not match a route-less or differently-scoped alert', () => {
		// R9 is only on a3.
		expect(alertsForRoute(ALERTS, 'R9').map((a) => a.id)).toEqual(['a3']);
		// A route nobody lists matches nothing.
		expect(alertsForRoute(ALERTS, 'R404')).toEqual([]);
	});

	it('sorts by severity desc, stable (source order) within a tier', () => {
		const set = [
			{ id: 'w', severity: 'watch', header_key: 'W', routes: ['R'] },
			{ id: 'h1', severity: 'high', header_key: 'H1', routes: ['R'] },
			{ id: 'c', severity: 'critical', header_key: 'C', routes: ['R'] },
			{ id: 'h2', severity: 'high', header_key: 'H2', routes: ['R'] },
		] as unknown as Alert[];
		// critical → both highs (in source order h1 before h2) → watch.
		expect(alertsForRoute(set, 'R').map((a) => a.id)).toEqual(['c', 'h1', 'h2', 'w']);
	});

	it('stands down (empty) for null/empty inputs — never throws', () => {
		expect(alertsForRoute(null, 'R1')).toEqual([]);
		expect(alertsForRoute(undefined, 'R1')).toEqual([]);
		expect(alertsForRoute(ALERTS, '')).toEqual([]);
	});
});

describe('alertsForStop', () => {
	it('matches an alert that lists the stop id in stops[]', () => {
		// S1 is listed by a1 directly; this stop serves no routes here.
		expect(alertsForStop(ALERTS, 'S1', null, []).map((a) => a.id)).toEqual(['a1']);
	});

	it('matches a route-scoped alert when that route SERVES the stop, severity-first', () => {
		// S5 is not listed by any alert, but it is served by route R1 → a2 (critical)
		// + a4 (high) surface on the stop, severity-first.
		expect(alertsForStop(ALERTS, 'S5', null, ['R1']).map((a) => a.id)).toEqual(['a2', 'a4']);
	});

	it('matches on BOTH the stop id and a served route (union, severity-first)', () => {
		// S2 is listed by a4 (stop) AND served by R1 → a2 (route) + a4 (stop+route).
		// a2 is critical → ranks first; a4 is high.
		expect(alertsForStop(ALERTS, 'S2', null, ['R1']).map((a) => a.id)).toEqual(['a2', 'a4']);
	});

	it('matches when the live feed targets the stop by CODE (id != code regression)', () => {
		// The live feed targets stops by their public CODE; for metro stations the
		// static index id differs from the code. An alert listing the CODE must
		// surface even though it never lists the id. (This is the bug the old
		// id-only keying masked because fixtures used id == code.)
		const byCode = [
			{ id: 'metro', severity: 'critical', header_key: 'M', stops: ['10254'] },
		] as unknown as Alert[];
		// id 'STATION-1' != code '10254'; the direct arm matches on the code.
		expect(alertsForStop(byCode, 'STATION-1', '10254', null).map((a) => a.id)).toEqual(['metro']);
		// Without the code, the id-only match would miss it entirely.
		expect(alertsForStop(byCode, 'STATION-1', null, null)).toEqual([]);
	});

	it('does NOT fabricate an association: no served routes → stop id/code only', () => {
		// Without routes_served, a route-only alert (a2) must not leak onto the stop.
		expect(alertsForStop(ALERTS, 'S2', null, null).map((a) => a.id)).toEqual(['a4']);
		expect(alertsForStop(ALERTS, 'S2', null, undefined).map((a) => a.id)).toEqual(['a4']);
	});

	it('ignores routes that do not serve the stop', () => {
		// S5 served by R2 (which no alert lists) and not listed anywhere → no match.
		expect(alertsForStop(ALERTS, 'S5', null, ['R2'])).toEqual([]);
	});

	it('prefers a directly-targeted alert over a route-serving one on a severity tie', () => {
		// Two HIGH alerts: aDirect targets the stop (stops[]), aRoute only serves it
		// (routes[]). Same severity → the more-specific (direct) one sorts first even
		// though it comes LATER in source order.
		const set = [
			{ id: 'aRoute', severity: 'high', header_key: 'R', routes: ['R1'] },
			{ id: 'aDirect', severity: 'high', header_key: 'D', stops: ['S1'] },
		] as unknown as Alert[];
		expect(alertsForStop(set, 'S1', null, ['R1']).map((a) => a.id)).toEqual(['aDirect', 'aRoute']);
		// A higher-severity route alert still outranks a lower-severity direct one
		// (severity dominates the direct/route tiebreak).
		const set2 = [
			{ id: 'aDirectWatch', severity: 'watch', header_key: 'D', stops: ['S1'] },
			{ id: 'aRouteCrit', severity: 'critical', header_key: 'R', routes: ['R1'] },
		] as unknown as Alert[];
		expect(alertsForStop(set2, 'S1', null, ['R1']).map((a) => a.id)).toEqual([
			'aRouteCrit',
			'aDirectWatch',
		]);
	});

	it('stands down (empty) for null/empty inputs — never throws', () => {
		expect(alertsForStop(null, 'S1', null, ['R1'])).toEqual([]);
		expect(alertsForStop(undefined, 'S1', null, ['R1'])).toEqual([]);
		expect(alertsForStop(ALERTS, '', null, ['R1'])).toEqual([]);
	});
});
