import { describe, it, expect } from 'vitest';
import { FILTER_SEARCH_PARAM_KEYS, fromSearchParams, toSearchParams } from './url';
import { isEmptyFilterState } from './state';
import type { FilterState } from './state';

const sp = (q: string) => new URLSearchParams(q);
const round = (q: string) => toSearchParams(fromSearchParams(sp(q))).toString();

describe('filter URL key inventory', () => {
	it('exports every canonical filter key in an immutable order', () => {
		expect(FILTER_SEARCH_PARAM_KEYS).toEqual([
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
		]);
		expect(Object.isFrozen(FILTER_SEARCH_PARAM_KEYS)).toBe(true);
	});
});

describe('fromSearchParams — parsing + self-healing', () => {
	it('collects comma-joined id sets, deduped', () => {
		const s = fromSearchParams(sp('route=10,80,10,165'));
		expect([...s.routes].sort()).toEqual(['10', '165', '80']);
	});

	it('collects repeated keys (route=10&route=80) the same as comma form', () => {
		const s = fromSearchParams(sp('route=10&route=80&route=10'));
		expect([...s.routes].sort()).toEqual(['10', '80']);
	});

	it('parses all four id-set families to their state fields', () => {
		const s = fromSearchParams(sp('route=10&stop=ABC&trip=T1&vehicle=40061'));
		expect([...s.routes]).toEqual(['10']);
		expect([...s.stops]).toEqual(['ABC']);
		expect([...s.trips]).toEqual(['T1']);
		expect([...s.vehicles]).toEqual(['40061']);
	});

	it('drops blank tokens (?route=  and 10,,80) instead of inserting empties', () => {
		const s = fromSearchParams(sp('route=10,,80&stop='));
		expect([...s.routes].sort()).toEqual(['10', '80']);
		expect(s.stops.size).toBe(0);
	});

	it('drops invalid status enum values, keeps the valid ones', () => {
		const s = fromSearchParams(sp('status=bogus,late'));
		expect(s.status).toEqual(['late']);
	});

	it('leaves an all-invalid enum field ABSENT (not an empty array)', () => {
		const s = fromSearchParams(sp('status=nope,never&occupancy=overflowing'));
		expect(s.status).toBeUndefined();
		expect(s.occupancy).toBeUndefined();
	});

	it('drops occupancy junk, keeps valid bands', () => {
		const s = fromSearchParams(sp('occupancy=full,bursting,empty'));
		expect(s.occupancy).toEqual(['full', 'empty']);
	});

	it('drops entity junk, keeps valid shape/entity filters', () => {
		const s = fromSearchParams(sp('entity=bus,bogus,stop,bus'));
		expect((s as { entities?: string[] }).entities).toEqual(['bus', 'stop']);
	});

	it('drops alert junk, keeps valid alert entity filters', () => {
		const s = fromSearchParams(sp('alert=has_alert,bogus,has_alert'));
		expect((s as { alerts?: string[] }).alerts).toEqual(['has_alert']);
	});

	it('keeps grain only when it is a valid Grain', () => {
		expect(fromSearchParams(sp('grain=week')).grain).toBe('week');
		expect(fromSearchParams(sp('grain=decade')).grain).toBeUndefined();
	});

	it('parses a complete ?from&?to pair into a {from,to} window', () => {
		expect(fromSearchParams(sp('from=2026-06-01&to=2026-06-14')).window).toEqual({
			from: '2026-06-01',
			to: '2026-06-14',
		});
	});

	it('parses a single-day pick (from==to) as a one-day window', () => {
		expect(fromSearchParams(sp('from=2026-06-14&to=2026-06-14')).window).toEqual({
			from: '2026-06-14',
			to: '2026-06-14',
		});
	});

	it('normalizes an inverted from>to pair so the stored window reads from<=to', () => {
		expect(fromSearchParams(sp('from=2026-06-14&to=2026-06-01')).window).toEqual({
			from: '2026-06-01',
			to: '2026-06-14',
		});
	});

	it('drops a HALF window (only ?from or only ?to) — a half window is no window', () => {
		expect(fromSearchParams(sp('from=2026-06-01')).window).toBeUndefined();
		expect(fromSearchParams(sp('to=2026-06-14')).window).toBeUndefined();
	});

	it('drops a MALFORMED bound (not YYYY-MM-DD) → no fabricated window', () => {
		expect(fromSearchParams(sp('from=yesterday&to=2026-06-14')).window).toBeUndefined();
		expect(fromSearchParams(sp('from=2026-6-1&to=2026-06-14')).window).toBeUndefined();
	});

	it('keeps ?n only when it is a valid worst-N rung (or "all")', () => {
		expect(fromSearchParams(sp('n=20')).worstN).toBe('20');
		expect(fromSearchParams(sp('n=all')).worstN).toBe('all');
	});

	it('drops a junk ?n (not one of the fixed rungs) → no fabricated cap', () => {
		expect(fromSearchParams(sp('n=7')).worstN).toBeUndefined();
		expect(fromSearchParams(sp('n=999')).worstN).toBeUndefined();
		expect(fromSearchParams(sp('n=')).worstN).toBeUndefined();
	});

	it('parses a valid ISO ?date (the receipt single-day key, S13)', () => {
		expect(fromSearchParams(sp('date=2026-06-16')).date).toBe('2026-06-16');
	});

	it('drops a malformed ?date (not YYYY-MM-DD) → self-heals to absent', () => {
		expect(fromSearchParams(sp('date=yesterday')).date).toBeUndefined();
		expect(fromSearchParams(sp('date=2026-6-1')).date).toBeUndefined();
		expect(fromSearchParams(sp('date=')).date).toBeUndefined();
	});

	it('keeps ?date ORTHOGONAL to the ?from/?to window pair', () => {
		const s = fromSearchParams(sp('date=2026-06-16&from=2026-06-01&to=2026-06-14'));
		expect(s.date).toBe('2026-06-16');
		expect(s.window).toEqual({ from: '2026-06-01', to: '2026-06-14' });
		expect(fromSearchParams(sp('date=2026-06-16')).window).toBeUndefined();
	});

	it('parses the alerts affects + severity axes (S15) and self-heals junk', () => {
		expect(fromSearchParams(sp('affects=lines')).alertAffects).toBe('lines');
		expect(fromSearchParams(sp('affects=stops')).alertAffects).toBe('stops');
		expect(fromSearchParams(sp('affects=all')).alertAffects).toBeUndefined();
		expect(fromSearchParams(sp('affects=bogus')).alertAffects).toBeUndefined();
		expect(fromSearchParams(sp('severity=critical')).alertSeverity).toBe('critical');
		expect(fromSearchParams(sp('severity=watch')).alertSeverity).toBe('watch');
		expect(fromSearchParams(sp('severity=apocalyptic')).alertSeverity).toBeUndefined();
	});

	it('round-trips the alerts axes alongside ?route/?stop/?from/?to (fixed point)', () => {
		const q = 'route=24&stop=52458&from=2026-06-01&to=2026-06-14&affects=lines&severity=high';
		expect(round(q)).toBe(round(round(q)));
		const s = fromSearchParams(sp(q));
		expect([...s.routes]).toEqual(['24']);
		expect([...s.stops]).toEqual(['52458']);
		expect(s.window).toEqual({ from: '2026-06-01', to: '2026-06-14' });
		expect(s.alertAffects).toBe('lines');
		expect(s.alertSeverity).toBe('high');
	});

	it('ignores unknown query keys', () => {
		const s = fromSearchParams(sp('utm_source=newsletter&route=10'));
		expect([...s.routes]).toEqual(['10']);
	});
});

describe('toSearchParams — canonical wire format', () => {
	it('sorts + comma-joins sets and omits empty fields', () => {
		const s: FilterState = {
			routes: new Set(['80', '10', '165']),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			status: ['late', 'severe'],
		};
		expect(toSearchParams(s).toString()).toBe('route=10%2C165%2C80&status=late%2Csevere');
	});

	it('emits keys in the stable contract order (route,stop,trip,vehicle,status,occupancy,entity,alert,grain,from,to,date,n)', () => {
		const s: FilterState = {
			routes: new Set(['10']),
			stops: new Set(['S']),
			trips: new Set(['T']),
			vehicles: new Set(['40061']),
			status: ['on_time'],
			occupancy: ['full'],
			entities: ['stop'],
			alerts: ['has_alert'],
			grain: 'day',
			window: { from: '2026-06-01', to: '2026-06-14' },
			date: '2026-06-16',
			worstN: '20',
		} as unknown as FilterState;
		const keys = [...toSearchParams(s).keys()];
		expect(keys).toEqual([
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
		]);
	});

	it('serializes the single-day ?date (omitted entirely when absent)', () => {
		const withDate: FilterState = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			date: '2026-06-16',
		};
		expect(toSearchParams(withDate).toString()).toBe('date=2026-06-16');
	});

	it('serializes the worst-N cap as ?n (omitted entirely when absent)', () => {
		const withN: FilterState = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			worstN: 'all',
		};
		expect(toSearchParams(withN).toString()).toBe('n=all');
	});

	it('serializes a window as the ?from&?to pair (omitted entirely when absent)', () => {
		const withWindow: FilterState = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			window: { from: '2026-06-01', to: '2026-06-14' },
		};
		expect(toSearchParams(withWindow).toString()).toBe('from=2026-06-01&to=2026-06-14');

		const noWindow: FilterState = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
		};
		expect(toSearchParams(noWindow).toString()).toBe('');
	});

	it('omits an empty enum array entirely', () => {
		const s: FilterState = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			status: [],
		};
		expect(toSearchParams(s).toString()).toBe('');
	});
});

describe('round-trip — toSearchParams(fromSearchParams(u)) is an idempotent fixed point', () => {
	const INPUTS = [
		'',
		'route=10',
		'route=80,10,165',
		'route=10&route=80',
		'route=10,,80&stop=',
		'status=bogus,late',
		'entity=bus,stop,bogus',
		'alert=has_alert,bogus',
		'route=165&stop=ABC&trip=T1&vehicle=40061&status=on_time,late&occupancy=full&entity=stop&alert=has_alert&grain=week&from=2026-06-01&to=2026-06-14',
		'from=2026-06-01&to=2026-06-14',
		'from=2026-06-14&to=2026-06-01',
		'from=2026-06-01',
		'utm_source=x&route=10',
		'grain=decade',
		'grain=range&from=2026-06-01&to=2026-06-14',
		'window=30',
		'n=20',
		'n=all',
		'n=7',
		'date=2026-06-16',
		'date=2026-06-16&from=2026-06-01&to=2026-06-14',
		'date=yesterday',
	];

	for (const input of INPUTS) {
		it(`?${input || '<empty>'} reaches a fixed point in one pass`, () => {
			const once = round(input);
			const twice = round(once);
			expect(twice).toBe(once);
		});

		it(`?${input || '<empty>'} re-parses value-equal (state is a fixed point)`, () => {
			const first = fromSearchParams(sp(input));
			const second = fromSearchParams(toSearchParams(first));
			expect([...second.routes].sort()).toEqual([...first.routes].sort());
			expect([...second.stops].sort()).toEqual([...first.stops].sort());
			expect([...second.trips].sort()).toEqual([...first.trips].sort());
			expect([...second.vehicles].sort()).toEqual([...first.vehicles].sort());
			expect(second.status).toEqual(first.status);
			expect(second.occupancy).toEqual(first.occupancy);
			expect((second as { entities?: string[] }).entities).toEqual(
				(first as { entities?: string[] }).entities,
			);
			expect((second as { alerts?: string[] }).alerts).toEqual(
				(first as { alerts?: string[] }).alerts,
			);
			expect(second.grain).toEqual(first.grain);
			expect(second.window).toEqual(first.window);
			expect(second.date).toEqual(first.date);
			expect(second.worstN).toEqual(first.worstN);
		});
	}

	it('canonicalizes ?grain=range&from&to to the from/to pair (grain dropped)', () => {
		expect(round('grain=range&from=2026-06-01&to=2026-06-14')).toBe(
			'from=2026-06-01&to=2026-06-14',
		);
	});

	it('canonicalizes the repeated-key + unsorted form to the comma + sorted form', () => {
		expect(round('route=80&route=10&route=165')).toBe('route=10%2C165%2C80');
	});
});

describe('back-compat — every published dialect keeps decoding (S7.5 decode table)', () => {
	it('/map?status=late — codec A unchanged, grain/window absent', () => {
		const s = fromSearchParams(sp('status=late'));
		expect(s.status).toEqual(['late']);
		expect(s.grain).toBeUndefined();
		expect(s.window).toBeUndefined();
	});

	it('/lines/24?grain=week — grain kept, no window', () => {
		const s = fromSearchParams(sp('grain=week'));
		expect(s.grain).toBe('week');
		expect(s.window).toBeUndefined();
	});

	it('/lines/24?grain=range&from&to — grain=range DROPPED (not a Grain), window carries the range', () => {
		const s = fromSearchParams(sp('grain=range&from=2026-06-01&to=2026-06-14'));
		expect(s.grain).toBeUndefined();
		expect(s.window).toEqual({ from: '2026-06-01', to: '2026-06-14' });
	});

	it('BARE ?grain=range (no from/to) — grain dropped, NO fabricated window', () => {
		const s = fromSearchParams(sp('grain=range'));
		expect(s.grain).toBeUndefined();
		expect(s.window).toBeUndefined();
	});

	it('/lines/24?from&to (no grain) — window present, grain absent (range implied by window)', () => {
		const s = fromSearchParams(sp('from=2026-06-01&to=2026-06-14'));
		expect(s.grain).toBeUndefined();
		expect(s.window).toEqual({ from: '2026-06-01', to: '2026-06-14' });
	});

	it('inverted ?from>to — normalized to from<=to', () => {
		expect(fromSearchParams(sp('from=2026-06-14&to=2026-06-01')).window).toEqual({
			from: '2026-06-01',
			to: '2026-06-14',
		});
	});

	it('half window (?from only) — window undefined', () => {
		expect(fromSearchParams(sp('from=2026-06-01')).window).toBeUndefined();
	});

	it('legacy ?window=30 / ?window=7 scalar — ignored (unknown key), no state', () => {
		expect(fromSearchParams(sp('window=30')).window).toBeUndefined();
		expect(fromSearchParams(sp('window=7')).window).toBeUndefined();
		expect(isEmptyFilterState(fromSearchParams(sp('window=30')))).toBe(true);
	});

	it('/lines/24?grain=day — grain kept unchanged', () => {
		expect(fromSearchParams(sp('grain=day')).grain).toBe('day');
	});

	it('/lines/24?tab=receipt — ?tab is a separate owner (RouteDetail), never in the codec', () => {
		const s = fromSearchParams(sp('tab=receipt&route=24'));
		expect([...s.routes]).toEqual(['24']);
		expect(toSearchParams(s).has('tab')).toBe(false);
	});
});
