// alertLog.ts — the PURE alert-log selectors (S15 de-monolith).
//
// The /alerts surface's client-side narrowing, lifted out of the .svelte orchestrator
// into a testable, DOM-free module: severity banding, the four filter axes (window +
// entity-type + severity + one specific line/stop), newest-first sort, and the per-row
// view-model build. Every localized string is INJECTED (label resolvers passed in) so
// this module owns zero copy and zero i18n — the surface hands down its bundle.
//
// HONESTY: an alert with no orderable start/first-seen instant sinks to the end (never
// dropped); a null field is carried as null (never a fabricated 0); the window match is
// inclusive and multi-period aware (see alertMatchesWindow). SSR-safe: pure data + pure
// functions.

import type { AlertBreakdownBucket, AlertHistoryEntry } from '$lib/v1/schemas/alert_history';
import { SEVERITY_CODES, type SeverityCode } from '$lib/v1/schemas/types';
import type { DateWindow, AlertAffects } from '$lib/filters';
import { providerLocalDateKey } from '$lib/utils/time';

const SEVERITY_SET = new Set<string>(SEVERITY_CODES);

/**
 * Band a history entry's FREE-STRING severity to a valid {@link SeverityCode}. The
 * historic build does not re-validate the closed enum, so an unexpected/absent value
 * bands to the quietest `watch` — an unknown severity must never paint as `critical`.
 */
export function bandSeverity(raw: string | null | undefined): SeverityCode {
	return raw != null && SEVERITY_SET.has(raw) ? (raw as SeverityCode) : 'watch';
}

/**
 * The active windows of an entry as a normalized `{start,end}` list. Prefers the S15
 * `active_periods` child rows; falls back to the scalar start/end pair as a single
 * window (legacy rows). Bounds are the raw ISO strings (or null for an open bound).
 */
export function activeWindows(
	entry: AlertHistoryEntry,
): readonly { readonly start: string | null; readonly end: string | null }[] {
	const periods = entry.active_periods ?? [];
	if (periods.length > 0) {
		return periods.map((p) => ({ start: p.start_utc ?? null, end: p.end_utc ?? null }));
	}
	// Legacy: the scalar pair is the one (primary) window. Both absent ⇒ no window.
	if (entry.start_utc != null || entry.end_utc != null) {
		return [{ start: entry.start_utc ?? null, end: entry.end_utc ?? null }];
	}
	return [];
}

/**
 * Does an alert intersect the inclusive `[from,to]` local-date window? An alert MATCHES
 * iff ANY of its active windows overlaps the span. A window with an open bound is treated
 * as unbounded on that side (an ongoing/undated alert stays visible). An alert with NO
 * datable window at all is KEPT (honest: we cannot prove it falls outside — never a
 * silent drop). The window bounds are local calendar dates (YYYY-MM-DD); we compare the
 * provider-local calendar key for each ISO instant, so a same-day alert on `to`
 * still counts even when its UTC date differs.
 */
export function alertMatchesWindow(entry: AlertHistoryEntry, window: DateWindow | null): boolean {
	if (window == null) return true;
	const windows = activeWindows(entry);
	if (windows.length === 0) return true; // undatable → cannot exclude honestly
	const from = window.from;
	const to = window.to;
	for (const w of windows) {
		// Provider-local calendar keys; null = open/invalid (unbounded that side).
		const s = providerLocalDateKey(w.start);
		const e = providerLocalDateKey(w.end);
		// Overlap test on inclusive spans: [s,e] ∩ [from,to] ≠ ∅
		//   fails only when the window ends before `from` OR starts after `to`.
		const endsBefore = e != null && e < from;
		const startsAfter = s != null && s > to;
		if (!endsBefore && !startsAfter) return true;
	}
	return false;
}

/** The four filter axes the surface narrows the log by (all optional/absent = no narrowing). */
export interface AlertLogFilters {
	/** The inclusive date window, or null (= no window narrowing). */
	readonly window: DateWindow | null;
	/** Entity-type axis: `lines`|`stops`|null (= all). */
	readonly affects: AlertAffects | null;
	/** Severity axis: one {@link SeverityCode} or null (= all). */
	readonly severity: SeverityCode | null;
	/** A specific chosen line id (mutually the "route" pick), or null. */
	readonly route: string | null;
	/** A specific chosen stop id, or null. */
	readonly stop: string | null;
}

type OrderableAlertHistoryEntry = AlertHistoryEntry & {
	/** Present on retained archive rows; absent on the legacy current-history fallback. */
	readonly first_seen_utc?: string | null;
	readonly last_seen_utc?: string | null;
};

/**
 * Sort a copy of `entries` newest-first by start instant, falling back to the archive's
 * first-seen instant. Last-seen and id break ties so mixed current/archive collections
 * stay deterministic. A truly undated entry sinks to the end — never dropped.
 */
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

/**
 * Apply the four filter axes to a newest-first list. Each axis is independent (AND-ed).
 * An empty routes/stops array means the alert does NOT affect that entity → excluded by
 * the entity-type axis or the specific-entity pick. Severity is banded the same way the
 * rows render it. Pure: never mutates the input.
 */
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

/** One rendered active-window range in a row's meta (localized bounds, injected). */
export interface AlertRowPeriod {
	readonly from: string | null;
	readonly until: string | null;
}

/** The per-row view-model the AlertLog presenter renders — no logic, just resolved values. */
export interface AlertRowVM {
	readonly id: string;
	readonly severity: SeverityCode;
	readonly headline: string;
	/** ALL active windows, localized (>1 ⇒ the presenter lists them as N service windows). */
	readonly periods: readonly AlertRowPeriod[];
	readonly durationMin: number | null;
	readonly routes: readonly string[];
	readonly stops: readonly string[];
	readonly impactPassages: number | null;
	/** A safe external URL (http/https only) + its hostname, or null when absent/unsafe. */
	readonly url: { readonly href: string; readonly host: string } | null;
}

/** Resolvers the surface injects so this module stays copy-free + DOM-free. */
export interface AlertRowResolvers {
	/** The locale-aware headline (alertDisplayText over a shaped Alert). */
	readonly headline: (entry: AlertHistoryEntry) => string;
	/** A localized wall-clock for an ISO bound, or null when absent/invalid. */
	readonly windowTime: (iso: string | null | undefined) => string | null;
}

/**
 * A safe external link for an alert `url`: only http/https is surfaced (a `javascript:`
 * / `data:` / malformed value is dropped honestly), and the hostname is exposed so the
 * presenter can show WHERE the link goes. Returns null when absent or unsafe.
 */
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

/** Build a row VM from an entry + the injected resolvers. Pure; carries null through honestly. */
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
		impactPassages: entry.impact_passages ?? null,
		url: safeAlertUrl(entry.url),
	};
}

/**
 * Derive the honest served span from the entries themselves (the legacy fallback when
 * the payload carries no window_start/window_end): the min→max active DATE across every
 * entry's windows. Returns null when nothing is datable (⇒ the surface hides the picker
 * with honest absence). Dates are provider-local `YYYY-MM-DD` keys.
 */
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

/**
 * Enumerate every local calendar date from `start` to `end` inclusive (ISO
 * `YYYY-MM-DD`), ascending — the DateRangePicker's `availableDates`. A zero-alert day
 * is a REAL answer (S15), so EVERY served day is selectable, not only the days an alert
 * happens to touch. Returns [] when the span is malformed or inverted.
 */
export function enumerateDates(start: string, end: string): string[] {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
	if (start > end) return [];
	const out: string[] = [];
	// Iterate at UTC noon to sidestep any DST edge on the date increment.
	const cursor = new Date(`${start}T12:00:00Z`);
	const last = new Date(`${end}T12:00:00Z`);
	// Guard against a pathological span (bad parse) so we never loop unbounded.
	let guard = 0;
	while (cursor <= last && guard < 100000) {
		out.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
		guard += 1;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Tier-2 breakdown rows (cause / effect / severity distributions).
// ---------------------------------------------------------------------------

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

/** Which distribution a bucket list belongs to (drives label resolution + bar tone). */
export type BreakdownKind = 'cause' | 'effect' | 'severity';

/** One RankedRow-ready breakdown bucket (title + relative bar value + count/median display). */
export interface BreakdownRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	readonly value: number | null;
	readonly display: string;
	readonly subtitle: string | undefined;
}

/** Copy resolvers the surface injects (title per bucket + count/median formatting). */
export interface BreakdownResolvers {
	readonly bucketTitle: (key: string, kind: BreakdownKind) => string;
	readonly countDisplay: (count: number) => string;
	readonly medianSubtitle: (min: number) => string;
}

/**
 * Build the RankedRow view-models for one distribution. Buckets with no count are
 * DROPPED (honest — never a fabricated empty bar); the bar value is the count relative
 * to the busiest bucket in THIS group (its own absolute domain). For the severity
 * distribution the bucket IS a severity → its bar rides that tone; cause/effect carry
 * no severity → a neutral `watch` tone. Sorted count-descending.
 */
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

/**
 * The median of a numeric list (half-away rounding is the caller's concern — we return
 * the exact median value). Used for the in-window headline sublabel from the breakdown.
 * Empty ⇒ null (honest absence). Even-length ⇒ the mean of the two middle values.
 */
export function medianOf(values: readonly number[]): number | null {
	const nums = values
		.filter((v) => Number.isFinite(v))
		.slice()
		.sort((a, b) => a - b);
	if (nums.length === 0) return null;
	const mid = Math.floor(nums.length / 2);
	return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
