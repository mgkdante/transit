// url.test.ts — the URL ⇄ FilterState codec gate. The URL is the canonical home
// of filter state (shareable, SSR-read, locale-switch-surviving), so the codec
// must be a stable fixed point and self-healing against hand-edited junk.
//
// Gates:
//   - ROUND-TRIP FIXED POINT: toSearchParams(fromSearchParams(u)) === a
//     canonical query string, and re-parsing is value-equal (idempotent).
//   - MULTI-VALUE SETS: comma-joined AND repeated keys both collect; the output
//     is sorted + comma-joined + deduped, with stable KEY order.
//   - SELF-HEALING: invalid enum tokens are DROPPED on the way in; an all-bad
//     enum leaves the field absent (and thus omitted from the URL).

import { describe, it, expect } from 'vitest';
import { fromSearchParams, toSearchParams } from './url';
import type { FilterState } from './state';

const sp = (q: string) => new URLSearchParams(q);
const round = (q: string) => toSearchParams(fromSearchParams(sp(q))).toString();

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
		const s = fromSearchParams(sp('entity=bus_direction,bogus,stop,bus_direction'));
		expect((s as { entities?: string[] }).entities).toEqual(['bus_direction', 'stop']);
	});

	it('drops alert junk, keeps valid alert entity filters', () => {
		const s = fromSearchParams(sp('alert=has_alert,bogus,has_alert'));
		expect((s as { alerts?: string[] }).alerts).toEqual(['has_alert']);
	});

	it('keeps grain only when it is a valid Grain', () => {
		expect(fromSearchParams(sp('grain=week')).grain).toBe('week');
		expect(fromSearchParams(sp('grain=decade')).grain).toBeUndefined();
	});

	it('trims window and omits it when blank', () => {
		expect(fromSearchParams(sp('window=7d')).window).toBe('7d');
		expect(fromSearchParams(sp('window=')).window).toBeUndefined();
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

	it('emits keys in the stable contract order (route,stop,trip,vehicle,status,occupancy,entity,alert,grain,window)', () => {
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
			window: '7d',
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
			'window',
		]);
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
		'route=10&route=80', // repeated-key form normalizes to comma form
		'route=10,,80&stop=', // junk normalizes away
		'status=bogus,late', // invalid enum drops
		'entity=bus_direction,stop,bogus',
		'alert=has_alert,bogus',
		'route=165&stop=ABC&trip=T1&vehicle=40061&status=on_time,late&occupancy=full&entity=stop&alert=has_alert&grain=week&window=7d',
		'utm_source=x&route=10', // unknown key drops
		'grain=decade', // invalid grain drops -> empty
	];

	for (const input of INPUTS) {
		it(`?${input || '<empty>'} reaches a fixed point in one pass`, () => {
			const once = round(input);
			const twice = round(once);
			// Applying the codec again to its own output changes nothing.
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
		});
	}

	it('canonicalizes the repeated-key + unsorted form to the comma + sorted form', () => {
		expect(round('route=80&route=10&route=165')).toBe('route=10%2C165%2C80');
	});
});
