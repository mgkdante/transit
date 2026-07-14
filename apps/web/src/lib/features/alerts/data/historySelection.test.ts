import { describe, expect, it } from 'vitest';
import type { AlertHistory, IsoUtc } from '$lib/v1/schemas';
import { AlertArchiveIndexSchema } from '$lib/v1/schemas';
import { filterAlertLog } from '../selectors/alertLog';
import {
	currentAlertWindow,
	resolveAlertHistoryRange,
	sameHistoryWindow,
} from './historySelection';

const GENERATED = '2026-07-13T12:00:00Z';
const utc = (value: string): IsoUtc => value as IsoUtc;

function history(partial: Partial<AlertHistory> = {}): AlertHistory {
	return {
		generated_utc: utc(GENERATED),
		alerts: [],
		...partial,
	};
}

function archive(first: string | null, last: string | null) {
	return AlertArchiveIndexSchema.parse({
		generated_utc: GENERATED,
		collection_generation_id: 'a'.repeat(64),
		first_available_date: first,
		last_available_date: last,
		total_alerts: first == null || last == null ? 0 : 1,
		months: [],
	});
}

describe('currentAlertWindow', () => {
	it('uses the valid legacy served window and clamps it to archive coverage', () => {
		expect(
			currentAlertWindow(
				history({ window_start: '2026-03-01', window_end: '2026-05-29' }),
				archive('2026-03-15', '2026-07-13'),
			),
		).toEqual({ from: '2026-03-15', to: '2026-05-29' });
	});

	it('falls back to the datable legacy entry span when served-window fields are absent', () => {
		expect(
			currentAlertWindow(
				history({
					alerts: [
						{
							id: 'late',
							start_utc: utc('2026-06-20T12:00:00Z'),
							end_utc: utc('2026-06-21T12:00:00Z'),
						},
						{
							id: 'early',
							start_utc: utc('2026-06-01T12:00:00Z'),
							end_utc: utc('2026-06-02T12:00:00Z'),
						},
					],
				}),
				archive('2026-01-01', '2026-07-13'),
			),
		).toEqual({ from: '2026-06-01', to: '2026-06-21' });
	});

	it('uses the latest real archive day when current and retained coverage do not overlap', () => {
		expect(
			currentAlertWindow(
				history({ window_start: '2025-01-01', window_end: '2025-03-31' }),
				archive('2026-01-01', '2026-07-13'),
			),
		).toEqual({ from: '2026-07-13', to: '2026-07-13' });
	});

	it('returns null when the index has no honest coverage bounds', () => {
		expect(
			currentAlertWindow(
				history({ window_start: '2026-03-01', window_end: '2026-05-29' }),
				archive(null, null),
			),
		).toBeNull();
	});

	it('keeps the legacy served window when the optional archive index is absent', () => {
		expect(
			currentAlertWindow(history({ window_start: '2026-06-01', window_end: '2026-06-30' }), null),
		).toEqual({ from: '2026-06-01', to: '2026-06-30' });
	});
});

describe('resolveAlertHistoryRange', () => {
	it('makes a planned future alert reachable through its advertised page coverage', () => {
		const index = AlertArchiveIndexSchema.parse({
			generated_utc: GENERATED,
			collection_generation_id: 'a'.repeat(64),
			first_available_date: '2026-07-01',
			last_available_date: '2026-07-01',
			total_alerts: 1,
			months: [
				{
					month: '2026-07',
					total_alerts: 1,
					pages: [
						{
							path: `historic/alerts/generations/${'a'.repeat(64)}/2026-07/page-0001.json`,
							page: 1,
							count: 1,
							byte_size: 100,
							sha256: 'a'.repeat(64),
							coverage_start: '2026-07-01',
							coverage_end: '2026-08-04',
						},
					],
				},
			],
		});
		const resolved = resolveAlertHistoryRange(
			history({ window_start: '2026-07-01', window_end: '2026-07-01' }),
			index,
			'2026-08-04',
			'2026-08-04',
		);
		const planned = {
			id: 'planned-work',
			active_periods: [
				{ start_utc: utc('2026-08-04T08:00:00Z'), end_utc: utc('2026-08-04T12:00:00Z') },
			],
		};

		expect(resolved.selection).toEqual({ from: '2026-08-04', to: '2026-08-04' });
		expect(
			filterAlertLog([planned], {
				window: resolved.selection,
				affects: null,
				severity: null,
				route: null,
				stop: null,
			}),
		).toEqual([planned]);
	});

	it('treats every day inside archive bounds as available, including a quiet day', () => {
		const resolved = resolveAlertHistoryRange(
			history({ window_start: '2026-06-01', window_end: '2026-06-30' }),
			archive('2026-01-01', '2026-07-13'),
			'2026-02-10',
			'2026-02-10',
		);

		expect(resolved.selection).toEqual({ from: '2026-02-10', to: '2026-02-10' });
		expect(resolved.intersectingGaps).toEqual([]);
		expect(resolved.correction).toBeNull();
	});

	it('preserves blank URL evidence as one malformed correction to the current default', () => {
		const resolved = resolveAlertHistoryRange(
			history({ window_start: '2026-06-01', window_end: '2026-06-30' }),
			archive('2026-01-01', '2026-07-13'),
			new URLSearchParams('from=&to=').get('from'),
			new URLSearchParams('from=&to=').get('to'),
		);

		expect(resolved.selection).toEqual({ from: '2026-06-01', to: '2026-06-30' });
		expect(resolved.canonicalWindow).toBeNull();
		expect(resolved.correction?.reason).toBe('malformed');
	});

	it('returns the shared honest empty resolution when archive coverage is empty', () => {
		expect(
			resolveAlertHistoryRange(
				history({ window_start: '2026-06-01', window_end: '2026-06-30' }),
				archive(null, null),
				null,
				null,
			),
		).toEqual({
			selection: null,
			canonicalWindow: null,
			intersectingGaps: [],
			correction: null,
		});
	});

	it('allows a valid selected range inside the legacy served span when the index is absent', () => {
		const resolved = resolveAlertHistoryRange(
			history({ window_start: '2026-06-01', window_end: '2026-06-30' }),
			null,
			'2026-06-10',
			'2026-06-12',
		);

		expect(resolved.selection).toEqual({ from: '2026-06-10', to: '2026-06-12' });
		expect(resolved.canonicalWindow).toEqual({ from: '2026-06-10', to: '2026-06-12' });
		expect(resolved.correction).toBeNull();
	});
});

describe('sameHistoryWindow', () => {
	it('compares normalized pairs so the current default can stay omitted', () => {
		expect(
			sameHistoryWindow(
				{ from: '2026-06-30', to: '2026-06-01' },
				{ from: '2026-06-01', to: '2026-06-30' },
			),
		).toBe(true);
		expect(
			sameHistoryWindow(
				{ from: '2026-06-01', to: '2026-06-29' },
				{ from: '2026-06-01', to: '2026-06-30' },
			),
		).toBe(false);
		expect(sameHistoryWindow(null, null)).toBe(true);
	});
});
