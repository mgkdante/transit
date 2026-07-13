import { describe, expect, it } from 'vitest';
import { AlertArchiveIndexSchema, ReceiptsIndexSchema } from '$lib/v1/schemas';
import type { DateWindow } from '$lib/filters';
import {
	addIsoDays,
	availabilityFromAlertIndex,
	availabilityFromReceiptsIndex,
	datesForAvailability,
	nextAvailableDate,
	previousAvailableDate,
	resolveHistoryDate,
	resolveHistoryRange,
	strictIsoDate,
	type HistoryAvailability,
} from './selection';

const continuous: HistoryAvailability = {
	kind: 'continuous',
	firstDate: '2026-03-01',
	lastDate: '2026-03-10',
	gaps: [{ start_date: '2026-03-04', end_date: '2026-03-05', reason: 'outage' }],
};

const discrete: HistoryAvailability = {
	kind: 'discrete',
	dates: ['2026-03-10', '2026-03-01', '2026-03-03', '2026-03-03', 'not-a-date'],
};

const defaultWindow: DateWindow = { from: '2026-03-02', to: '2026-03-08' };

describe('strict ISO calendar dates and UTC arithmetic', () => {
	it('accepts real YYYY-MM-DD dates and rejects shape-valid impossible dates', () => {
		expect(strictIsoDate('2024-02-29')).toBe(true);
		expect(strictIsoDate('2026-02-28')).toBe(true);
		expect(strictIsoDate('2026-02-29')).toBe(false);
		expect(strictIsoDate('2026-02-30')).toBe(false);
		expect(strictIsoDate('2026-13-01')).toBe(false);
		expect(strictIsoDate('2026-2-01')).toBe(false);
		expect(strictIsoDate(null)).toBe(false);
	});

	it('crosses leap day without skipping or repeating', () => {
		expect(addIsoDays('2024-02-28', 1)).toBe('2024-02-29');
		expect(addIsoDays('2024-02-29', 1)).toBe('2024-03-01');
		expect(addIsoDays('2024-03-01', -1)).toBe('2024-02-29');
	});

	it('crosses both Montréal DST boundaries using UTC calendar days', () => {
		expect(addIsoDays('2026-03-07', 1)).toBe('2026-03-08');
		expect(addIsoDays('2026-03-08', 1)).toBe('2026-03-09');
		expect(addIsoDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addIsoDays('2026-11-01', 1)).toBe('2026-11-02');
	});
});

describe('availability normalization', () => {
	it('enumerates continuous coverage while excluding explicit inclusive gaps', () => {
		expect(datesForAvailability(continuous)).toEqual([
			'2026-03-01',
			'2026-03-02',
			'2026-03-03',
			'2026-03-06',
			'2026-03-07',
			'2026-03-08',
			'2026-03-09',
			'2026-03-10',
		]);
	});

	it('normalizes discrete dates to the exact sorted de-duplicated real set', () => {
		expect(datesForAvailability(discrete)).toEqual(['2026-03-01', '2026-03-03', '2026-03-10']);
		expect(datesForAvailability({ kind: 'empty' })).toEqual([]);
	});

	it('uses honest alert first/last dates without inventing gaps from empty months', () => {
		const index = AlertArchiveIndexSchema.parse({
			generated_utc: '2026-07-13T12:00:00Z',
			collection_generation_id: 'generation',
			first_available_date: '2026-01-01',
			last_available_date: '2026-03-31',
			total_alerts: 2,
			months: [],
		});

		expect(availabilityFromAlertIndex(index)).toEqual({
			kind: 'continuous',
			firstDate: '2026-01-01',
			lastDate: '2026-03-31',
			gaps: [],
		});
		expect(availabilityFromAlertIndex(null)).toBeNull();
		expect(
			availabilityFromAlertIndex({
				...index,
				first_available_date: null,
				last_available_date: null,
			}),
		).toEqual({ kind: 'empty' });
	});

	it('uses only receipt index dates; metadata cannot add a publication date', () => {
		const index = ReceiptsIndexSchema.parse({
			generated_utc: '2026-07-13T12:00:00Z',
			dates: ['2026-03-03', '2026-03-01', '2026-03-03'],
			available: [
				{ date: '2026-03-02', has_data: true },
				{ date: '2026-03-03', has_data: true },
			],
		});

		expect(availabilityFromReceiptsIndex(index)).toEqual({
			kind: 'discrete',
			dates: ['2026-03-01', '2026-03-03'],
		});
		expect(availabilityFromReceiptsIndex(null)).toEqual({ kind: 'empty' });
	});
});

describe('point history resolution and neighbors', () => {
	it('resolves an absent or explicit latest selection to latest with a null canonical date', () => {
		expect(resolveHistoryDate(undefined, discrete)).toEqual({
			selection: '2026-03-10',
			canonicalDate: null,
			correction: null,
		});
		expect(resolveHistoryDate('2026-03-10', discrete)).toEqual({
			selection: '2026-03-10',
			canonicalDate: null,
			correction: null,
		});
		expect(resolveHistoryDate('2026-03-03', discrete)).toEqual({
			selection: '2026-03-03',
			canonicalDate: '2026-03-03',
			correction: null,
		});
	});

	it('falls back to latest with stable malformed/outside/gap/unpublished corrections', () => {
		const malformedA = resolveHistoryDate('2026-02-30', continuous);
		const malformedB = resolveHistoryDate('2026-02-30', continuous);
		expect(malformedA.selection).toBe('2026-03-10');
		expect(malformedA.canonicalDate).toBeNull();
		expect(malformedA.correction?.reason).toBe('malformed');
		expect(malformedA.correction?.key).toBe(malformedB.correction?.key);

		expect(resolveHistoryDate('2026-02-28', continuous).correction?.reason).toBe(
			'outside-coverage',
		);
		expect(resolveHistoryDate('2026-03-04', continuous).correction?.reason).toBe('gap');
		expect(resolveHistoryDate('2026-03-02', discrete).correction?.reason).toBe('unpublished');
		expect(resolveHistoryDate('2026-03-11', discrete).correction?.reason).toBe('outside-coverage');
	});

	it('treats a present blank URL date as malformed instead of absent', () => {
		const rawDate = new URLSearchParams('date=').get('date');
		const first = resolveHistoryDate(rawDate, discrete);
		const second = resolveHistoryDate(new URLSearchParams('date=').get('date'), discrete);

		expect(rawDate).toBe('');
		expect(first.selection).toBe('2026-03-10');
		expect(first.canonicalDate).toBeNull();
		expect(first.correction?.reason).toBe('malformed');
		expect(first.correction?.key).toBe(second.correction?.key);
	});

	it('resolves empty availability to a null selection without fabricating a correction', () => {
		expect(resolveHistoryDate('2026-03-01', { kind: 'empty' })).toEqual({
			selection: null,
			canonicalDate: null,
			correction: null,
		});
	});

	it('moves to the nearest real neighbor and skips continuous/discrete gaps', () => {
		expect(previousAvailableDate('2026-03-06', continuous)).toBe('2026-03-03');
		expect(nextAvailableDate('2026-03-03', continuous)).toBe('2026-03-06');
		expect(previousAvailableDate('2026-03-10', discrete)).toBe('2026-03-03');
		expect(nextAvailableDate('2026-03-01', discrete)).toBe('2026-03-03');
		expect(previousAvailableDate('2026-03-01', discrete)).toBeNull();
		expect(nextAvailableDate('2026-03-10', discrete)).toBeNull();
	});
});

describe('range history resolution', () => {
	it('uses the caller default for absent bounds and reports crossed explicit gaps', () => {
		expect(resolveHistoryRange(undefined, undefined, continuous, defaultWindow)).toEqual({
			selection: defaultWindow,
			canonicalWindow: null,
			intersectingGaps: [{ start_date: '2026-03-04', end_date: '2026-03-05', reason: 'outage' }],
			correction: null,
		});
	});

	it('normalizes a complete inverted range and permits crossing a declared gap', () => {
		const resolved = resolveHistoryRange('2026-03-08', '2026-03-03', continuous, defaultWindow);
		expect(resolved.selection).toEqual({ from: '2026-03-03', to: '2026-03-08' });
		expect(resolved.canonicalWindow).toEqual({ from: '2026-03-03', to: '2026-03-08' });
		expect(resolved.intersectingGaps).toEqual([
			{ start_date: '2026-03-04', end_date: '2026-03-05', reason: 'outage' },
		]);
		expect(resolved.correction).toBeNull();
	});

	it('falls back once for malformed, half, outside, gap-bound, or unpublished bounds', () => {
		const cases = [
			['2026-02-30', '2026-03-03', continuous, 'malformed'],
			['2026-03-03', undefined, continuous, 'malformed'],
			['2026-02-28', '2026-03-03', continuous, 'outside-coverage'],
			['2026-03-04', '2026-03-08', continuous, 'gap'],
			['2026-03-02', '2026-03-03', discrete, 'unpublished'],
		] as const;

		for (const [from, to, availability, reason] of cases) {
			const resolved = resolveHistoryRange(from, to, availability, defaultWindow);
			expect(resolved.selection).toEqual(defaultWindow);
			expect(resolved.canonicalWindow).toBeNull();
			expect(resolved.correction?.reason).toBe(reason);
		}
	});

	it('treats present blank URL range bounds as malformed instead of absent', () => {
		const params = new URLSearchParams('from=&to=');
		const first = resolveHistoryRange(
			params.get('from'),
			params.get('to'),
			continuous,
			defaultWindow,
		);
		const repeated = new URLSearchParams('from=&to=');
		const second = resolveHistoryRange(
			repeated.get('from'),
			repeated.get('to'),
			continuous,
			defaultWindow,
		);

		expect(params.get('from')).toBe('');
		expect(params.get('to')).toBe('');
		expect(first.selection).toEqual(defaultWindow);
		expect(first.canonicalWindow).toBeNull();
		expect(first.correction?.reason).toBe('malformed');
		expect(first.correction?.key).toBe(second.correction?.key);
	});

	it('returns stable correction keys and null for empty availability', () => {
		const first = resolveHistoryRange('2026-03-02', '2026-03-03', discrete, defaultWindow);
		const second = resolveHistoryRange('2026-03-02', '2026-03-03', discrete, defaultWindow);
		expect(first.correction?.key).toBe(second.correction?.key);

		expect(
			resolveHistoryRange('2026-03-01', '2026-03-02', { kind: 'empty' }, defaultWindow),
		).toEqual({
			selection: null,
			canonicalWindow: null,
			intersectingGaps: [],
			correction: null,
		});
	});
});
