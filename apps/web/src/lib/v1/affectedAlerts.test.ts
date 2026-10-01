import { describe, expect, it } from 'vitest';
import type { Alert } from './schemas';
import { alertsForRoute, alertsForStop } from './affectedAlerts';

const ALERTS = [
	{ id: 'a1', severity: 'high', header_key: 'A1', stops: ['S1'] },
	{ id: 'a2', severity: 'critical', header_key: 'A2', routes: ['R1'] },
	{ id: 'a3', severity: 'watch', header_key: 'A3', routes: ['R9'], stops: ['S9'] },
	{ id: 'a4', severity: 'high', header_key: 'A4', routes: ['R1'], stops: ['S2'] },
] as unknown as Alert[];

describe('alertsForRoute', () => {
	it('returns alerts whose routes[] lists the route id, severity-first', () => {
		const out = alertsForRoute(ALERTS, 'R1');
		expect(out.map((a) => a.id)).toEqual(['a2', 'a4']);
	});

	it('does not match a route-less or differently-scoped alert', () => {
		expect(alertsForRoute(ALERTS, 'R9').map((a) => a.id)).toEqual(['a3']);
		expect(alertsForRoute(ALERTS, 'R404')).toEqual([]);
	});

	it('sorts by severity desc, stable (source order) within a tier', () => {
		const set = [
			{ id: 'w', severity: 'watch', header_key: 'W', routes: ['R'] },
			{ id: 'h1', severity: 'high', header_key: 'H1', routes: ['R'] },
			{ id: 'c', severity: 'critical', header_key: 'C', routes: ['R'] },
			{ id: 'h2', severity: 'high', header_key: 'H2', routes: ['R'] },
		] as unknown as Alert[];
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
		expect(alertsForStop(ALERTS, 'S1', null, []).map((a) => a.id)).toEqual(['a1']);
	});

	it('matches a route-scoped alert when that route SERVES the stop, severity-first', () => {
		expect(alertsForStop(ALERTS, 'S5', null, ['R1']).map((a) => a.id)).toEqual(['a2', 'a4']);
	});

	it('matches on BOTH the stop id and a served route (union, severity-first)', () => {
		expect(alertsForStop(ALERTS, 'S2', null, ['R1']).map((a) => a.id)).toEqual(['a2', 'a4']);
	});

	it('matches when the live feed targets the stop by CODE (id != code regression)', () => {
		const byCode = [
			{ id: 'metro', severity: 'critical', header_key: 'M', stops: ['10254'] },
		] as unknown as Alert[];
		expect(alertsForStop(byCode, 'STATION-1', '10254', null).map((a) => a.id)).toEqual(['metro']);
		expect(alertsForStop(byCode, 'STATION-1', null, null)).toEqual([]);
	});

	it('does NOT fabricate an association: no served routes → stop id/code only', () => {
		expect(alertsForStop(ALERTS, 'S2', null, null).map((a) => a.id)).toEqual(['a4']);
		expect(alertsForStop(ALERTS, 'S2', null, undefined).map((a) => a.id)).toEqual(['a4']);
	});

	it('ignores routes that do not serve the stop', () => {
		expect(alertsForStop(ALERTS, 'S5', null, ['R2'])).toEqual([]);
	});

	it('prefers a directly-targeted alert over a route-serving one on a severity tie', () => {
		const set = [
			{ id: 'aRoute', severity: 'high', header_key: 'R', routes: ['R1'] },
			{ id: 'aDirect', severity: 'high', header_key: 'D', stops: ['S1'] },
		] as unknown as Alert[];
		expect(alertsForStop(set, 'S1', null, ['R1']).map((a) => a.id)).toEqual(['aDirect', 'aRoute']);
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
