import type { AlertBreakdownBucket, AlertHistoryEntry } from '$lib/v1/schemas/alert_history';
import { SEVERITY_CODES, type SeverityCode } from '$lib/v1/schemas/types';
import type { DateWindow, AlertAffects } from '$lib/filters';
import { providerLocalDateKey } from '$lib/utils/time';
import type { AlertDisplayResult } from '$lib/v1/alertDisplay';

const SEVERITY_SET = new Set<string>(SEVERITY_CODES);

export function bandSeverity(raw: string | null | undefined): SeverityCode {
	return raw != null && SEVERITY_SET.has(raw) ? (raw as SeverityCode) : 'watch';
}

export function activeWindows(
	entry: AlertHistoryEntry,
): readonly { readonly start: string | null; readonly end: string | null }[] {
	const periods = entry.active_periods ?? [];
	if (periods.length > 0) {
		return periods.map((p) => ({ start: p.start_utc ?? null, end: p.end_utc ?? null }));
	}
	if (entry.start_utc != null || entry.end_utc != null) {
		return [{ start: entry.start_utc ?? null, end: entry.end_utc ?? null }];
	}
	return [];
}

export function alertMatchesWindow(entry: AlertHistoryEntry, window: DateWindow | null): boolean {
	if (window == null) return true;
	const windows = activeWindows(entry);
	if (windows.length === 0) return true;
	const from = window.from;
	const to = window.to;
	for (const w of windows) {
		const s = providerLocalDateKey(w.start);
		const e = providerLocalDateKey(w.end);
		const endsBefore = e != null && e < from;
		const startsAfter = s != null && s > to;
		if (!endsBefore && !startsAfter) return true;
	}
	return false;
}

export interface AlertLogFilters {
	readonly window: DateWindow | null;
	readonly affects: AlertAffects | null;
	readonly severity: SeverityCode | null;
	readonly route: string | null;
	readonly stop: string | null;
}

type OrderableAlertHistoryEntry = AlertHistoryEntry & {
	readonly first_seen_utc?: string | null;
	readonly last_seen_utc?: string | null;
};

export function sortNewestFirst<T extends OrderableAlertHistoryEntry>(
	entries: readonly T[],
): readonly T[] {
	const stamp = (value: string | null | undefined): number => {
		const ms = value != null ? Date.parse(value) : NaN;
		return Number.isNaN(ms) ? -Infinity : ms;
	};
	const newestFirst = (left: number, right: number): number => {
		if (left === right) return 0;
		return left > right ? -1 : 1;
	};
	return entries.slice().sort((a, b) => {
		const primaryOrder = newestFirst(
			stamp(a.start_utc ?? a.first_seen_utc),
			stamp(b.start_utc ?? b.first_seen_utc),
		);
		if (primaryOrder !== 0) return primaryOrder;

		const observationOrder = newestFirst(stamp(a.last_seen_utc), stamp(b.last_seen_utc));
		if (observationOrder !== 0) return observationOrder;

		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

export function filterAlertLog(
	entries: readonly AlertHistoryEntry[],
	filters: AlertLogFilters,
): readonly AlertHistoryEntry[] {
	return entries.filter((e) => {
		if (!alertMatchesWindow(e, filters.window)) return false;
		if (filters.affects === 'lines' && (e.routes?.length ?? 0) === 0) return false;
		if (filters.affects === 'stops' && (e.stops?.length ?? 0) === 0) return false;
		if (filters.severity != null && bandSeverity(e.severity) !== filters.severity) return false;
		if (filters.route != null && !(e.routes ?? []).includes(filters.route)) return false;
		if (filters.stop != null && !(e.stops ?? []).includes(filters.stop)) return false;
		return true;
	});
}

export interface AlertRowPeriod {
	readonly from: string | null;
	readonly until: string | null;
}

export interface AlertRowVM {
	readonly id: string;
	readonly severity: SeverityCode;
	readonly headline: AlertDisplayResult;
	readonly periods: readonly AlertRowPeriod[];
	readonly durationMin: number | null;
	readonly routes: readonly string[];
	readonly stops: readonly string[];
	readonly url: { readonly href: string; readonly host: string } | null;
}

export interface AlertRowResolvers {
	readonly headline: (entry: AlertHistoryEntry) => AlertDisplayResult;
	readonly windowTime: (iso: string | null | undefined) => string | null;
}

export function safeAlertUrl(
	raw: string | null | undefined,
): { readonly href: string; readonly host: string } | null {
	if (raw == null) return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	return { href: parsed.href, host: parsed.host };
}

export function buildAlertRow(entry: AlertHistoryEntry, r: AlertRowResolvers): AlertRowVM {
	const windows = activeWindows(entry);
	const periods: AlertRowPeriod[] = windows.map((w) => ({
		from: r.windowTime(w.start),
		until: r.windowTime(w.end),
	}));
	return {
		id: entry.id,
		severity: bandSeverity(entry.severity),
		headline: r.headline(entry),
		periods,
		durationMin: entry.duration_min ?? null,
		routes: entry.routes ?? [],
		stops: entry.stops ?? [],
		url: safeAlertUrl(entry.url),
	};
}

export function deriveSpan(
	entries: readonly AlertHistoryEntry[],
): { readonly start: string; readonly end: string } | null {
	let min: string | null = null;
	let max: string | null = null;
	for (const e of entries) {
		for (const w of activeWindows(e)) {
			for (const bound of [w.start, w.end]) {
				if (bound == null) continue;
				const d = providerLocalDateKey(bound);
				if (d == null) continue;
				if (min == null || d < min) min = d;
				if (max == null || d > max) max = d;
			}
		}
	}
	return min != null && max != null ? { start: min, end: max } : null;
}

export function enumerateDates(start: string, end: string): string[] {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
	if (start > end) return [];
	const out: string[] = [];
	const cursor = new Date(`${start}T12:00:00Z`);
	const last = new Date(`${end}T12:00:00Z`);
	let guard = 0;
	while (cursor <= last && guard < 100000) {
		out.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
		guard += 1;
	}
	return out;
}

export interface SummarizedAlertBreakdown {
	readonly by_cause: readonly AlertBreakdownBucket[];
	readonly by_effect: readonly AlertBreakdownBucket[];
	readonly by_severity: readonly AlertBreakdownBucket[];
}

function summarizeBuckets(
	entries: readonly AlertHistoryEntry[],
	keyFor: (entry: AlertHistoryEntry) => string,
): AlertBreakdownBucket[] {
	const groups = new Map<string, { count: number; durations: number[] }>();
	for (const entry of entries) {
		const key = keyFor(entry).trim() || 'unknown';
		const group = groups.get(key) ?? { count: 0, durations: [] };
		group.count += 1;
		if (entry.duration_min != null && Number.isFinite(entry.duration_min)) {
			group.durations.push(entry.duration_min);
		}
		groups.set(key, group);
	}
	return Array.from(groups, ([key, group]) => ({
		key,
		count: group.count,
		median_duration_min: medianOf(group.durations),
	}));
}

export function summarizeAlertBreakdown(
	entries: readonly AlertHistoryEntry[],
): SummarizedAlertBreakdown {
	return {
		by_cause: summarizeBuckets(entries, (entry) => entry.cause ?? 'unknown'),
		by_effect: summarizeBuckets(entries, (entry) => entry.effect ?? 'unknown'),
		by_severity: summarizeBuckets(entries, (entry) => bandSeverity(entry.severity)),
	};
}

export type BreakdownKind = 'cause' | 'effect' | 'severity';

export interface BreakdownRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	readonly value: number | null;
	readonly display: string;
	readonly subtitle: string | undefined;
}

export interface BreakdownResolvers {
	readonly bucketTitle: (key: string, kind: BreakdownKind) => string;
	readonly countDisplay: (count: number) => string;
	readonly medianSubtitle: (min: number) => string;
}

export function toBreakdownRows(
	buckets: readonly AlertBreakdownBucket[] | undefined,
	kind: BreakdownKind,
	r: BreakdownResolvers,
): BreakdownRow[] {
	const real = (buckets ?? []).filter((b) => (b.count ?? 0) > 0);
	const maxCount = real.reduce((m, b) => Math.max(m, b.count ?? 0), 0);
	return real
		.slice()
		.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
		.map((b, i) => {
			const count = b.count ?? 0;
			const median = b.median_duration_min ?? null;
			return {
				key: b.key,
				rank: i + 1,
				title: r.bucketTitle(b.key, kind),
				severity: kind === 'severity' ? bandSeverity(b.key) : 'watch',
				value: maxCount > 0 ? count / maxCount : null,
				display: r.countDisplay(count),
				subtitle: median != null ? r.medianSubtitle(median) : undefined,
			};
		});
}

export function medianOf(values: readonly number[]): number | null {
	const nums = values
		.filter((v) => Number.isFinite(v))
		.slice()
		.sort((a, b) => a - b);
	if (nums.length === 0) return null;
	const mid = Math.floor(nums.length / 2);
	return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
