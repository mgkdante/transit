import { describe, expect, it } from 'vitest';
import { buildOffenderLedger, publishedSeverity } from './offenderLedger';
import type { Offender } from '$lib/v1/schemas';

const labels = {
	typeLabel: (type: string) => (type === 'route' ? 'Line' : type === 'stop' ? 'Stop' : 'Entity'),
	recurrenceLabel: 'recurs',
	recurrenceUnknown: 'recurrence not recorded',
	fmtMin: (v: number | null) => (v == null ? null : `${v.toFixed(1)} min`),
	viewDetail: (title: string) => `View detail for ${title}`,
	// A minimal href builder mirroring the orchestrator's target resolution (pure — the
	// selector no longer imports $lib/nav, keeping it node-safe in the "data" project).
	href: (o: Offender) =>
		o.type === 'stop'
			? `/stop/${o.id}`
			: o.route
				? `/lines/${o.route}`
				: o.type === 'route'
					? `/lines/${o.id}`
					: `/stop/${o.id}`,
};

describe('publishedSeverity — READ the contract, never re-derive', () => {
	it('maps the published bands verbatim', () => {
		expect(publishedSeverity('critical')).toBe('critical');
		expect(publishedSeverity('high')).toBe('high');
		expect(publishedSeverity('watch')).toBe('watch');
	});
	it('an absent / unknown severity bands to the quietest watch, never a hot band', () => {
		expect(publishedSeverity(null)).toBe('watch');
		expect(publishedSeverity(undefined)).toBe('watch');
		expect(publishedSeverity('nonsense')).toBe('watch');
	});
});

describe('buildOffenderLedger — the doctrine-clean fallback ledger', () => {
	it('preserves worst-first order + carries the RAW avg_delay_min as the bar value', () => {
		const list: Offender[] = [
			{
				type: 'route',
				id: '11',
				route: '11',
				route_name: 'Montagne',
				avg_delay_min: 12.4,
				severity: 'critical',
			},
			{
				type: 'stop',
				id: '5',
				route: null,
				route_name: null,
				avg_delay_min: 6.2,
				severity: 'high',
			},
		];
		const rows = buildOffenderLedger(list, labels);
		expect(rows.map((r) => r.rank)).toEqual([1, 2]);
		// RAW minute value (NOT a /worst quotient) — the caller pairs it with the absolute domain.
		expect(rows[0].value).toBe(12.4);
		expect(rows[1].value).toBe(6.2);
		expect(rows[0].display).toBe('12.4 min');
		expect(rows[0].severity).toBe('critical');
		expect(rows[1].severity).toBe('high');
	});

	it('links a route to /lines/{route} and a stop to /stop/{id}', () => {
		const rows = buildOffenderLedger(
			[
				{ type: 'route', id: '11', route: '11', route_name: 'Montagne', avg_delay_min: 5 },
				{ type: 'stop', id: '57191', route: null, route_name: null, avg_delay_min: 3 },
			],
			labels,
		);
		expect(rows[0].href).toBe('/lines/11');
		expect(rows[1].href).toBe('/stop/57191');
	});

	it('a null avg_delay_min → null value + null display (honest absence, never 0)', () => {
		const rows = buildOffenderLedger(
			[{ type: 'route', id: '9', route: '9', route_name: 'X', avg_delay_min: null }],
			labels,
		);
		expect(rows[0].value).toBeNull();
		expect(rows[0].display).toBeNull();
	});

	it('keys on (type, id, route) so a shared id on two routes yields distinct keys', () => {
		const rows = buildOffenderLedger(
			[
				{ type: 'route', id: '42010', route: '49', route_name: null, avg_delay_min: 11 },
				{ type: 'route', id: '42010', route: '55', route_name: null, avg_delay_min: 9 },
			],
			labels,
		);
		expect(rows[0].key).not.toBe(rows[1].key);
	});

	it('reads the honest recurrence fallback when no recurrence string is present', () => {
		const rows = buildOffenderLedger(
			[
				{
					type: 'stop',
					id: '99',
					route: null,
					route_name: null,
					avg_delay_min: 8,
					recurrence: null,
				},
			],
			labels,
		);
		expect(rows[0].subtitle).toContain('recurrence not recorded');
	});
});
