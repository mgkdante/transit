import { describe, it, expect } from 'vitest';
import { selectNotReportedLines, NOT_REPORTED_DOMAIN } from './notReportedLines';

const labels = {
	routeName: (id: string, name: string | null | undefined) => name ?? `Line ${id}`,
	rowLabel: 'Line',
	href: (id: string) => `/lines/${id}`,
	viewDetail: (id: string) => `View line ${id}`,
	fmtScheduled: (v: number | null | undefined) => (v == null ? null : `${v} scheduled`),
};

describe('selectNotReportedLines', () => {
	it('builds ranked rows linking to /lines/[id] on the fixed count domain', () => {
		const vm = selectNotReportedLines(
			{
				not_reported_route_count: 3,
				not_reported_routes: [
					{ id: '51', name: 'Édouard-Montpetit', scheduled_trip_days: 12 },
					{ id: '24', name: 'Sherbrooke', scheduled_trip_days: 8 },
				],
			},
			labels,
		);
		expect(vm.hasData).toBe(true);
		expect(vm.rows[0].href).toBe('/lines/51');
		expect(vm.rows[0].title).toBe('Édouard-Montpetit');
		expect(vm.rows[0].domain).toBe(NOT_REPORTED_DOMAIN);
		expect(vm.rows[0].severity).toBe('critical');
		expect(vm.rows[0].display).toBe('12 scheduled');
	});

	it('carries the shown/total honesty (pre-cap count vs capped list)', () => {
		const vm = selectNotReportedLines(
			{
				not_reported_route_count: 200, // mass-outage day
				not_reported_routes: [{ id: '1', name: null, scheduled_trip_days: 5 }],
			},
			labels,
		);
		expect(vm.shown).toBe(1);
		expect(vm.total).toBe(200);
	});

	it('stands down on ramp-in — an ABSENT list is honest-absence, not an empty "all reported"', () => {
		expect(selectNotReportedLines(undefined, labels).hasData).toBe(false);
		expect(selectNotReportedLines({ not_reported_routes: [] }, labels).hasData).toBe(false);
	});
});
