import { describe, it, expect } from 'vitest';
import { selectWorstOfDay } from './day-worst';

const labels = {
	routeName: (id: string, name: string | null | undefined) => name ?? `Route ${id}`,
	stopName: (id: string, name: string | null | undefined) => name ?? `Stop ${id}`,
	routeLabel: 'Worst line',
	stopLabel: 'Worst stop',
	routeDeltaLabel: 'On-time vs network',
	stopDelayLabel: 'Average delay',
	fmtDelta: (v: number | null | undefined) =>
		v == null ? 'no data' : `${v > 0 ? '+' : ''}${v} pts`,
	fmtMin: (v: number | null | undefined) => (v == null ? 'no data' : `${v} min`),
};

describe('selectWorstOfDay', () => {
	it('builds both worst rows with resolved title/subtitle/meta', () => {
		const vm = selectWorstOfDay(
			{
				worst_route: { id: '161', name: 'Van Horne', otp_delta_pts: -8 },
				worst_stop: { id: '57191', name: 'Rockland', avg_delay_min: 6.1 },
			},
			labels,
		);
		expect(vm.hasWorst).toBe(true);
		expect(vm.route?.title).toBe('Van Horne');
		expect(vm.route?.subtitle).toBe('Worst line · 161');
		expect(vm.route?.meta).toBe('On-time vs network -8 pts');
		expect(vm.stop?.meta).toBe('Average delay 6.1 min');
	});

	it('stands the panel down when neither worst entity carries an id', () => {
		const vm = selectWorstOfDay({ worst_route: null, worst_stop: null }, labels);
		expect(vm.hasWorst).toBe(false);
		expect(vm.route).toBeNull();
		expect(vm.stop).toBeNull();
	});

	it('drops a worst entity that has no id (never a linkless row)', () => {
		const vm = selectWorstOfDay(
			{
				worst_route: { id: '', name: 'x', otp_delta_pts: -1 },
				worst_stop: { id: '40001', name: null, avg_delay_min: 7.8 },
			},
			labels,
		);
		expect(vm.route).toBeNull();
		expect(vm.stop?.title).toBe('Stop 40001');
		expect(vm.hasWorst).toBe(true);
	});
});
