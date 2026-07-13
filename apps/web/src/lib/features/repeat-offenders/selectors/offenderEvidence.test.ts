import { describe, expect, it } from 'vitest';
import type { RepeatOffenderEntry } from '$lib/v1/schemas';
import { buildOffenderEvidenceRows } from './offenderEvidence';

const entry = (overrides: Partial<RepeatOffenderEntry>): RepeatOffenderEntry => ({
	type: 'trip',
	id: 'T1',
	route: '11',
	route_name: 'Montagne / Sommet',
	severe_pct: 62,
	wilson_lo: 30,
	wilson_hi: 44,
	recurrence_days: 5,
	observed_days: 7,
	avg_delay_min: 9.4,
	observation_count: 210,
	...overrides,
});

const labels = {
	unnamed: (item: RepeatOffenderEntry) => `Item ${item.id}`,
	href: (item: RepeatOffenderEntry) => (item.route ? `/lines/${item.route}` : null),
	ariaLabel: (title: string) => `View detail for ${title}`,
	typeId: (item: RepeatOffenderEntry) => `${item.type} · ${item.id}`,
	severeRate: (value: number | null | undefined) => (value == null ? null : `${value}%`),
	confidenceInterval: (lower: number, upper: number) => `${lower}%–${upper}%`,
	recurrence: (item: RepeatOffenderEntry) =>
		item.recurrence_days != null && item.observed_days != null
			? `${item.recurrence_days} of ${item.observed_days} days`
			: 'recurrence not recorded',
	averageDelay: (value: number | null | undefined) => (value == null ? null : `${value} min`),
	readings: (value: number | null | undefined) => (value == null ? null : String(value)),
};

describe('buildOffenderEvidenceRows', () => {
	it('preserves exact input order and cap while presenting flipped CI, nulls, and a real zero', () => {
		const rows = buildOffenderEvidenceRows(
			[
				entry({ id: 'T-first', route: '51', route_name: 'First', observation_count: 210 }),
				entry({
					type: 'vehicle',
					id: 'V-null',
					route: null,
					route_name: null,
					severe_pct: null,
					wilson_lo: null,
					wilson_hi: null,
					recurrence_days: null,
					observed_days: null,
					avg_delay_min: null,
					observation_count: null,
				}),
				entry({
					id: 'T-zero',
					route: '0',
					route_name: 'Zero',
					severe_pct: 0,
					wilson_lo: 100,
					wilson_hi: 100,
					recurrence_days: 0,
					observed_days: 7,
					avg_delay_min: 0,
					observation_count: 0,
				}),
				entry({ id: 'T-capped', route_name: 'Capped' }),
			],
			3,
			labels,
		);

		expect(rows.map((row) => row.key)).toEqual([
			'trip-T-first-51',
			'vehicle-V-null-',
			'trip-T-zero-0',
		]);
		expect(rows).toEqual([
			{
				key: 'trip-T-first-51',
				title: 'First',
				href: '/lines/51',
				ariaLabel: 'View detail for First',
				typeId: 'trip · T-first',
				severeRate: '62%',
				confidenceInterval: '56%–70%',
				recurrence: '5 of 7 days',
				averageDelay: '9.4 min',
				readings: '210',
			},
			{
				key: 'vehicle-V-null-',
				title: 'Item V-null',
				href: null,
				ariaLabel: 'View detail for Item V-null',
				typeId: 'vehicle · V-null',
				severeRate: null,
				confidenceInterval: null,
				recurrence: 'recurrence not recorded',
				averageDelay: null,
				readings: null,
			},
			{
				key: 'trip-T-zero-0',
				title: 'Zero',
				href: '/lines/0',
				ariaLabel: 'View detail for Zero',
				typeId: 'trip · T-zero',
				severeRate: '0%',
				confidenceInterval: '0%–0%',
				recurrence: '0 of 7 days',
				averageDelay: '0 min',
				readings: '0',
			},
		]);
	});
});
