// alertLog.test.ts — the PURE alert-log selectors (S15). Runs in the node "data"
// project (no DOM). Covers severity banding, multi-period window clipping (incl. the
// legacy scalar fallback), the filter axes, span derivation, date enumeration, the
// safe-URL guard, and the breakdown/median builders.

import { describe, it, expect } from 'vitest';
import type { AlertHistoryEntry } from '$lib/v1/schemas';
import {
	bandSeverity,
	activeWindows,
	alertMatchesWindow,
	filterAlertLog,
	sortNewestFirst,
	buildAlertRow,
	safeAlertUrl,
	deriveSpan,
	enumerateDates,
	medianOf,
	summarizeAlertBreakdown,
	toBreakdownRows,
} from './alertLog';

// ISO instants are branded (IsoUtc) at the type level; test fixtures pass plain
// strings, so accept a loose shape and cast once (matching the surface test pattern).
type LooseEntry = {
	id?: string;
	severity?: string | null;
	routes?: string[];
	stops?: string[];
	start_utc?: string | null;
	end_utc?: string | null;
	first_seen_utc?: string | null;
	last_seen_utc?: string | null;
	duration_min?: number | null;
	impact_passages?: number | null;
	cause?: string | null;
	effect?: string | null;
	active_periods?: Array<{ start_utc?: string | null; end_utc?: string | null }>;
};
const entry = (over: LooseEntry): AlertHistoryEntry =>
	({ id: over.id ?? 'x', ...over }) as unknown as AlertHistoryEntry;

describe('bandSeverity', () => {
	it('passes a valid code and bands junk/absent to the quietest watch', () => {
		expect(bandSeverity('critical')).toBe('critical');
		expect(bandSeverity('high')).toBe('high');
		expect(bandSeverity('nope')).toBe('watch');
		expect(bandSeverity(null)).toBe('watch');
		expect(bandSeverity(undefined)).toBe('watch');
	});
});

describe('activeWindows', () => {
	it('prefers active_periods; falls back to the scalar pair; empty when undatable', () => {
		expect(
			activeWindows(
				entry({
					active_periods: [
						{ start_utc: '2026-06-01T00:00:00Z', end_utc: '2026-06-02T00:00:00Z' },
						{ start_utc: '2026-06-10T00:00:00Z', end_utc: null },
					],
				}),
			),
		).toHaveLength(2);
		expect(
			activeWindows(entry({ start_utc: '2026-06-05T00:00:00Z', end_utc: '2026-06-06T00:00:00Z' })),
		).toEqual([{ start: '2026-06-05T00:00:00Z', end: '2026-06-06T00:00:00Z' }]);
		expect(activeWindows(entry({}))).toEqual([]);
	});
});

describe('alertMatchesWindow — inclusive, multi-period aware', () => {
	const win = { from: '2026-06-10', to: '2026-06-20' };

	it('keeps an alert whose scalar window overlaps the span', () => {
		expect(
			alertMatchesWindow(
				entry({ start_utc: '2026-06-12T00:00:00Z', end_utc: '2026-06-13T00:00:00Z' }),
				win,
			),
		).toBe(true);
	});

	it('excludes an alert entirely before or after the span', () => {
		expect(
			alertMatchesWindow(
				entry({ start_utc: '2026-06-01T00:00:00Z', end_utc: '2026-06-05T00:00:00Z' }),
				win,
			),
		).toBe(false);
		expect(
			alertMatchesWindow(
				entry({ start_utc: '2026-06-25T00:00:00Z', end_utc: '2026-06-26T00:00:00Z' }),
				win,
			),
		).toBe(false);
	});

	it('matches when ANY of several active periods intersects the span', () => {
		const e = entry({
			active_periods: [
				{ start_utc: '2026-05-01T00:00:00Z', end_utc: '2026-05-02T00:00:00Z' }, // before
				{ start_utc: '2026-06-15T00:00:00Z', end_utc: '2026-06-16T00:00:00Z' }, // inside
			],
		});
		expect(alertMatchesWindow(e, win)).toBe(true);
	});

	it('treats an open bound as unbounded on that side (ongoing alert stays visible)', () => {
		expect(
			alertMatchesWindow(entry({ start_utc: '2026-06-15T00:00:00Z', end_utc: null }), win),
		).toBe(true);
	});

	it('keeps an undatable alert (cannot prove it falls outside) and passes a null window', () => {
		expect(alertMatchesWindow(entry({}), win)).toBe(true);
		expect(alertMatchesWindow(entry({ start_utc: '2020-01-01T00:00:00Z' }), null)).toBe(true);
	});

	it('counts a same-day alert on the `to` boundary (inclusive)', () => {
		expect(
			alertMatchesWindow(
				entry({ start_utc: '2026-06-20T23:00:00Z', end_utc: '2026-06-20T23:30:00Z' }),
				win,
			),
		).toBe(true);
	});

	it.each([
		['summer previous day', '2026-08-05T00:30:00Z', '2026-08-04'],
		['spring DST previous day', '2026-03-08T04:30:00Z', '2026-03-07'],
		['fall DST previous day', '2026-11-01T03:30:00Z', '2026-10-31'],
	])('matches %s in the STM provider-local calendar', (_label, instant, localDate) => {
		const localWindow = { from: localDate, to: localDate };
		expect(alertMatchesWindow(entry({ start_utc: instant, end_utc: instant }), localWindow)).toBe(
			true,
		);
	});
});

describe('filterAlertLog — the four axes AND-ed', () => {
	const log = [
		entry({ id: 'L1', severity: 'critical', routes: ['10'], stops: [] }),
		entry({ id: 'S1', severity: 'high', routes: [], stops: ['52458'] }),
		entry({ id: 'B1', severity: 'watch', routes: ['24'], stops: ['99999'] }),
	];
	const none = { window: null, affects: null, severity: null, route: null, stop: null } as const;

	it('affects=lines excludes the stops-only alert', () => {
		const out = filterAlertLog(log, { ...none, affects: 'lines' });
		expect(out.map((e) => e.id)).toEqual(['L1', 'B1']);
	});

	it('affects=stops excludes the lines-only alert', () => {
		const out = filterAlertLog(log, { ...none, affects: 'stops' });
		expect(out.map((e) => e.id)).toEqual(['S1', 'B1']);
	});

	it('severity narrows to the matching band', () => {
		expect(filterAlertLog(log, { ...none, severity: 'critical' }).map((e) => e.id)).toEqual(['L1']);
	});

	it('a chosen route/stop narrows to alerts touching it (route 24 vs stop never collide)', () => {
		expect(filterAlertLog(log, { ...none, route: '24' }).map((e) => e.id)).toEqual(['B1']);
		expect(filterAlertLog(log, { ...none, stop: '52458' }).map((e) => e.id)).toEqual(['S1']);
	});

	it('combines axes to zero honestly', () => {
		expect(filterAlertLog(log, { ...none, route: '24', severity: 'critical' })).toHaveLength(0);
	});
});

describe('sortNewestFirst — newest observed alert first, truly undated rows last', () => {
	it('falls back to first_seen, then last_seen and id for deterministic archive ordering', () => {
		const out = sortNewestFirst([
			entry({ id: 'undated-z' }),
			entry({ id: 'archive-old', first_seen_utc: '2026-06-15T00:00:00Z' }),
			entry({ id: 'current', start_utc: '2026-06-18T00:00:00Z' }),
			entry({ id: 'archive-new', first_seen_utc: '2026-06-20T00:00:00Z' }),
			entry({
				id: 'tie-older-observation',
				first_seen_utc: '2026-06-10T00:00:00Z',
				last_seen_utc: '2026-06-11T00:00:00Z',
			}),
			entry({
				id: 'tie-newer-observation',
				first_seen_utc: '2026-06-10T00:00:00Z',
				last_seen_utc: '2026-06-12T00:00:00Z',
			}),
			entry({ id: 'undated-a' }),
		]);
		expect(out.map((e) => e.id)).toEqual([
			'archive-new',
			'current',
			'archive-old',
			'tie-newer-observation',
			'tie-older-observation',
			'undated-a',
			'undated-z',
		]);
	});
});

describe('buildAlertRow', () => {
	const resolvers = {
		headline: () => 'Service alert',
		windowTime: (iso: string | null | undefined) => (iso == null ? null : iso.slice(0, 10)),
	};

	it('carries null through honestly + lists all periods', () => {
		const vm = buildAlertRow(
			entry({
				id: 'r',
				severity: 'high',
				routes: ['10'],
				stops: [],
				duration_min: null,
				impact_passages: null,
				active_periods: [
					{ start_utc: '2026-06-01T00:00:00Z', end_utc: '2026-06-02T00:00:00Z' },
					{ start_utc: '2026-06-10T00:00:00Z', end_utc: null },
				],
			}),
			resolvers,
		);
		expect(vm.severity).toBe('high');
		expect(vm.durationMin).toBeNull();
		expect(vm.impactPassages).toBeNull();
		expect(vm.periods).toHaveLength(2);
		expect(vm.periods[1].until).toBeNull();
	});
});

describe('safeAlertUrl — http/https only, hostname exposed', () => {
	it('surfaces a safe url with its host', () => {
		expect(safeAlertUrl('https://stm.info/a/b')).toEqual({
			href: 'https://stm.info/a/b',
			host: 'stm.info',
		});
	});
	it('drops an unsafe/malformed value honestly', () => {
		expect(safeAlertUrl('javascript:alert(1)')).toBeNull();
		expect(safeAlertUrl('data:text/html,x')).toBeNull();
		expect(safeAlertUrl('not a url')).toBeNull();
		expect(safeAlertUrl(null)).toBeNull();
		expect(safeAlertUrl('  ')).toBeNull();
	});
});

describe('deriveSpan + enumerateDates — the legacy fallback + every-day-selectable', () => {
	it('derives the provider-local min→max active date across every window', () => {
		expect(
			deriveSpan([
				entry({ start_utc: '2026-06-05T00:00:00Z', end_utc: '2026-06-06T00:00:00Z' }),
				entry({
					active_periods: [{ start_utc: '2026-06-01T00:00:00Z', end_utc: '2026-06-20T00:00:00Z' }],
				}),
			]),
		).toEqual({ start: '2026-05-31', end: '2026-06-19' });
	});
	it('returns null when nothing is datable', () => {
		expect(deriveSpan([entry({}), entry({ routes: ['10'] })])).toBeNull();
	});
	it('enumerates every served day inclusive (a zero-alert day is a real answer)', () => {
		expect(enumerateDates('2026-06-01', '2026-06-03')).toEqual([
			'2026-06-01',
			'2026-06-02',
			'2026-06-03',
		]);
		expect(enumerateDates('2026-06-03', '2026-06-01')).toEqual([]);
		expect(enumerateDates('bad', '2026-06-03')).toEqual([]);
	});
});

describe('medianOf', () => {
	it('returns the median (odd/even) and null on empty', () => {
		expect(medianOf([3, 1, 2])).toBe(2);
		expect(medianOf([1, 2, 3, 4])).toBe(2.5);
		expect(medianOf([])).toBeNull();
	});
});

describe('summarizeAlertBreakdown', () => {
	const filteredEntries = [
		entry({ id: 'a', cause: 'weather', effect: 'delay', severity: 'high', duration_min: 10 }),
		entry({ id: 'b', cause: 'weather', effect: 'delay', severity: 'high', duration_min: 30 }),
		entry({ id: 'c', cause: '  ', effect: null, severity: 'unexpected', duration_min: Infinity }),
		entry({ id: 'd', cause: 'weather', effect: ' ', severity: 'critical', duration_min: 20 }),
		entry({ id: 'e', cause: null, effect: 'detour', severity: null, duration_min: NaN }),
	];

	it('counts supplied entries by cause, effect, and banded severity', () => {
		const summary = summarizeAlertBreakdown(filteredEntries);

		expect(summary.by_cause).toEqual([
			{ key: 'weather', count: 3, median_duration_min: 20 },
			{ key: 'unknown', count: 2, median_duration_min: null },
		]);
		expect(summary.by_effect).toEqual([
			{ key: 'delay', count: 2, median_duration_min: 20 },
			{ key: 'unknown', count: 2, median_duration_min: 20 },
			{ key: 'detour', count: 1, median_duration_min: null },
		]);
		expect(summary.by_severity).toEqual([
			{ key: 'high', count: 2, median_duration_min: 20 },
			{ key: 'watch', count: 2, median_duration_min: null },
			{ key: 'critical', count: 1, median_duration_min: 20 },
		]);
	});

	it('groups blank cause/effect as unknown and uses only finite bucket durations', () => {
		const summary = summarizeAlertBreakdown([
			entry({ id: 'blank', cause: ' ', effect: '', severity: 'watch', duration_min: Infinity }),
			entry({ id: 'null', cause: null, effect: null, severity: 'watch', duration_min: 12 }),
		]);

		expect(summary.by_cause).toEqual([{ key: 'unknown', count: 2, median_duration_min: 12 }]);
		expect(summary.by_effect).toEqual([{ key: 'unknown', count: 2, median_duration_min: 12 }]);
	});

	it('returns empty distributions for an empty filtered set', () => {
		expect(summarizeAlertBreakdown([])).toEqual({
			by_cause: [],
			by_effect: [],
			by_severity: [],
		});
	});

	it('changes counts with the supplied subset instead of leaking a server aggregate', () => {
		const all = summarizeAlertBreakdown(filteredEntries);
		const narrowed = summarizeAlertBreakdown([filteredEntries[0], filteredEntries[3]]);

		expect(all.by_cause[0]).toMatchObject({ key: 'weather', count: 3 });
		expect(narrowed).toEqual({
			by_cause: [{ key: 'weather', count: 2, median_duration_min: 15 }],
			by_effect: [
				{ key: 'delay', count: 1, median_duration_min: 10 },
				{ key: 'unknown', count: 1, median_duration_min: 20 },
			],
			by_severity: [
				{ key: 'high', count: 1, median_duration_min: 10 },
				{ key: 'critical', count: 1, median_duration_min: 20 },
			],
		});
	});
});

describe('toBreakdownRows', () => {
	const r = {
		bucketTitle: (key: string) => key,
		countDisplay: (n: number) => `${n} alerts`,
		medianSubtitle: (m: number) => `median ${m}`,
	};
	it('drops zero-count buckets, sorts desc, scales to the group max', () => {
		const rows = toBreakdownRows(
			[
				{ key: 'A', count: 2, median_duration_min: 10 },
				{ key: 'B', count: 8, median_duration_min: null },
				{ key: 'Z', count: 0 },
			],
			'cause',
			r,
		);
		expect(rows.map((x) => x.key)).toEqual(['B', 'A']);
		expect(rows[0].value).toBe(1);
		expect(rows[1].value).toBe(0.25);
		expect(rows[0].subtitle).toBeUndefined();
		expect(rows[1].subtitle).toBe('median 10');
	});
});
