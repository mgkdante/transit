import { expect, it } from 'vitest';
import { networkReliabilityView } from './reliabilityView';
import type { NetworkFile } from './index';

it('keeps absent live data separate from measured zero', () => {
	expect(networkReliabilityView()).toEqual({ live: null, points: [], byShift: [], byDaytype: [] });
	const live = {
		on_time_pct: 0,
		coverage_pct: 0,
		delay_p50_min: 0,
		delay_p90_min: 0,
		vehicles_in_service: 0,
		non_responding: 0,
		status_dist: { early: 0, on_time: 0, late: 0, severe: 0, unknown: 0 },
		delay_histogram: [{ lo_min: -1, hi_min: 0, count: 2 }],
		non_responding_by_route: [{ route_id: '51', count: 0 }],
	} as NetworkFile;
	Object.freeze(live);
	expect(networkReliabilityView({ live }).live).toMatchObject({
		onTimePct: 0,
		coveragePct: 0,
		p50Min: 0,
		p90Min: 0,
		vehicles: 0,
		silentTrips: 0,
	});
	const projected = networkReliabilityView({ live }).live!;
	expect(projected.statusDistribution).toBe(live.status_dist);
	expect(projected.delayBuckets).toBe(live.delay_histogram);
	expect(projected.silentByLine).toBe(live.non_responding_by_route);
	expect(projected.occupancyMix).toBeNull();
});

it('keeps ordered shifts separate from day types', () => {
	const shifts = Object.freeze([
		Object.freeze({ grain: 'night', otp_pct: null, severe_pct: 20, avg_delay_min: -1 }),
	]);
	const days = Object.freeze([Object.freeze({ grain: 'weekday', otp_pct: 0 })]);
	const view = networkReliabilityView({ byShift: shifts, byDaytype: days });
	expect(view.byShift).toEqual([
		{ grain: 'night', onTimePct: null, meanDelayMin: -1, severePct: 20 },
	]);
	expect(view.byDaytype).toEqual([
		{ grain: 'weekday', onTimePct: 0, meanDelayMin: null, severePct: null },
	]);
});

it('preserves ordered gaps, missing values, negatives and the retained mean/OTP invariant', () => {
	const points = Object.freeze([
		Object.freeze({
			date: '2026-01-01',
			otp_pct: 80,
			avg_delay_min: -1,
			p90_min: 0,
			vehicles: 0,
			cancellation_rate: 0,
			service_completeness_rate: NaN,
		}),
		Object.freeze({ date: '2026-01-03', otp_pct: null }),
	]);
	const view = networkReliabilityView({ points });
	expect(view.points.map((point) => point.date)).toEqual(['2026-01-01', '2026-01-03']);
	expect(view.points[0]).toMatchObject({ onTimePct: 80, meanDelayMin: -1, p90Min: 0 });
	expect(view.points[0]).toMatchObject({ vehicles: 0, cancellationPct: 0, completenessPct: NaN });
	expect(view.points[1]).toMatchObject({ onTimePct: null, meanDelayMin: null, vehicles: null });
	for (const point of view.points)
		if (point.meanDelayMin != null) expect(point.onTimePct).not.toBeNull();
	expect(points[0]).toMatchObject({ avg_delay_min: -1 });
});
