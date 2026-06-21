// reliabilitySnapshot.svelte.ts — the SHARED lazy reliability loader.
//
// The crux of the data-depth sweep for the LIST surfaces (/lines + /search): a
// flat catalogue can have hundreds of rows, but each row wants a per-entity
// headline reliability (OTP% + status verdict + a tiny day-series). A naive
// fetch-per-row would fire hundreds of /v1 requests on first paint and hammer
// the snapshot worker. This loader makes that signal CHEAP and POLITE:
//
//   (a) PER-ID CACHE — every id is fetched AT MOST ONCE. The cache survives the
//       lifetime of the loader instance (one per surface), so re-rendering /
//       re-sorting / re-filtering a row never refetches.
//
//   (b) CONCURRENCY CAP + RENDERED-ONLY — a row registers interest by calling
//       `request(id)` (wired to an IntersectionObserver via the `reliability`
//       action, so ONLY rows actually scrolled into view fetch). Requests beyond
//       the cap queue; at most MAX_IN_FLIGHT fetches run at once. The full
//       catalogue is NEVER fanned out — only the rendered window.
//
//   (c) FAIL-SOFT — a 404 (no history for this id) OR any network/parse error
//       resolves the entry to a terminal "no data" state. The row simply shows
//       no badge — never an error, never a spinner storm, never a fabricated 0%.
//
// HONESTY: a null/absent OTP yields NO verdict and NO badge (see otpVerdict).
// We never invent a 0% "severe" for an id with no published history.
//
// SSR-safe: the IntersectionObserver lives in the `reliability` action, which
// only runs in the browser; the store itself touches no DOM. In a non-browser
// (or observer-less) context the action falls back to requesting immediately.
//
// DEFER (tracked follow-ups, out of scope this batch): no reliability GRAIN
// selection on the inline snapshot (always the latest day); no near-me/distance
// ordering; no accessible-only filter (needs a DB field).

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { getRouteReliability, getStopReliability } from './repositories';
import type {
	ReliabilityPeriod,
	RouteReliability,
	StopReliabilityPeriod,
	StopReliability,
} from './schemas';
import { otpVerdict } from './reliabilityVerdict';
import type { StatusCode } from './schemas';

/** The entity families that carry a per-id reliability archive. */
export type ReliabilityKind = 'route' | 'stop';

/** Load phase for one id's snapshot. `idle` = never requested. */
export type ReliabilityPhase = 'idle' | 'loading' | 'ready' | 'empty';

/** The reactive snapshot a row reads. `null`s are honest no-data, never zeros. */
export interface ReliabilitySnapshot {
	/** Load phase — drives whether the row shows a badge yet. */
	readonly phase: ReliabilityPhase;
	/** Headline on-time %, latest available period; null when absent. */
	readonly otpPct: number | null;
	/** Status verdict mapped from `otpPct`; null when there is no OTP to read. */
	readonly verdict: StatusCode | null;
	/** A short OTP-per-day series (oldest→newest) for an optional sparkline; gaps stay null. */
	readonly series: Array<number | null>;
}

/** At most this many reliability fetches run concurrently across ALL rows. */
const MAX_IN_FLIGHT = 4;

/** How many trailing day-grain periods feed the inline sparkline. */
const SERIES_LEN = 14;

const EMPTY_SNAPSHOT: ReliabilitySnapshot = {
	phase: 'idle',
	otpPct: null,
	verdict: null,
	series: [],
};

/** A terminal "no data" snapshot — fail-soft target for 404s + errors. */
const NO_DATA_SNAPSHOT: ReliabilitySnapshot = {
	phase: 'empty',
	otpPct: null,
	verdict: null,
	series: [],
};

type PeriodLike = Pick<ReliabilityPeriod | StopReliabilityPeriod, 'grain' | 'otp_pct'>;

/**
 * Reduce a reliability file's day-grain periods into a headline + series. Day
 * grain only (the inline snapshot reads the most recent closed day; week/month
 * aggregates are a deferred grain-selection follow-up). Returns the no-data
 * snapshot when nothing usable is present.
 */
function summarize(
	periods: readonly PeriodLike[] | undefined,
	dateOf?: (p: PeriodLike) => string | null | undefined,
): ReliabilitySnapshot {
	const days = (periods ?? []).filter((p) => p.grain === 'day');
	if (days.length === 0) return NO_DATA_SNAPSHOT;

	// Oldest→newest by date when a date accessor is given; otherwise trust the
	// published order. The headline is the NEWEST day's OTP (last in series).
	const ordered = dateOf
		? [...days].sort((a, b) => String(dateOf(a) ?? '').localeCompare(String(dateOf(b) ?? '')))
		: days;

	const tail = ordered.slice(-SERIES_LEN);
	const series = tail.map((p) => (p.otp_pct == null ? null : p.otp_pct));

	// Headline = the most recent day that actually carries an OTP (skip trailing
	// no-data days), so a single missing latest day doesn't blank the badge.
	let otpPct: number | null = null;
	for (let i = ordered.length - 1; i >= 0; i--) {
		if (ordered[i].otp_pct != null) {
			otpPct = ordered[i].otp_pct as number;
			break;
		}
	}

	if (otpPct == null) return { phase: 'empty', otpPct: null, verdict: null, series };
	return { phase: 'ready', otpPct, verdict: otpVerdict(otpPct), series };
}

function summarizeRoute(file: RouteReliability | null): ReliabilitySnapshot {
	if (!file) return NO_DATA_SNAPSHOT;
	return summarize(file.periods, (p) => (p as ReliabilityPeriod).date);
}

function summarizeStop(file: StopReliability | null): ReliabilitySnapshot {
	if (!file) return NO_DATA_SNAPSHOT;
	// Stop periods carry no date field — trust the published order (recent last).
	return summarize(file.periods);
}

/**
 * The `reliability` action / `request` argument. A bare id keeps the legacy
 * probe-everything behaviour; the object form lets a caller pass the published
 * availability flag (`RouteIndexEntry.reliability`) so the loader can SKIP a
 * fetch for an id that is explicitly known to have no published file.
 */
export type ReliabilityTarget = string | { id: string; known?: boolean };

function targetId(target: ReliabilityTarget): string {
	return typeof target === 'string' ? target : target.id;
}

function targetKnown(target: ReliabilityTarget): boolean | undefined {
	return typeof target === 'string' ? undefined : target.known;
}

/** The public surface of a reliability snapshot loader instance. */
export interface ReliabilityLoader {
	/**
	 * Read the current snapshot for an id (reactive). Pure read — does NOT trigger
	 * a fetch; pair with `request(id)` (usually via the `reliability` action) so
	 * only rendered rows load.
	 */
	get(id: string): ReliabilitySnapshot;
	/**
	 * Register interest in a row. Fetches its id (subject to the concurrency cap)
	 * the first time only; subsequent calls are no-ops thanks to the per-id cache.
	 *
	 * When passed `{ id, known: false }` the loader treats the id as explicitly
	 * having NO published reliability file and resolves it straight to the
	 * terminal no-data state WITHOUT a network probe (kills the 404 flood). For a
	 * bare id, or `known` `true`/`undefined`, the legacy probe behaviour is kept —
	 * so snapshots published before the `reliability` flag existed still surface
	 * badges via the fail-soft 404 path.
	 */
	request(target: ReliabilityTarget): void;
	/** A Svelte action: request the row when it scrolls into view (browser). */
	reliability: (node: Element, target: ReliabilityTarget) => { destroy(): void };
	/** Test/diagnostic: how many fetches are currently in flight. */
	readonly inFlight: number;
}

/**
 * Build a reliability snapshot loader for one entity kind. One instance per
 * surface (the /lines index and the /search results each own one), so the cache
 * + the concurrency budget are scoped to that surface and torn down with it.
 */
export function createReliabilityLoader(kind: ReliabilityKind): ReliabilityLoader {
	// Per-id REACTIVE cache: every requested id has exactly one entry, replaced as
	// its fetch settles. A SvelteMap makes a `get(id)` read reactive, so the row's
	// badge updates the moment that id's snapshot lands — without refetching any
	// other id (the cache IS the dedupe).
	const cache = new SvelteMap<string, ReliabilitySnapshot>();
	let inFlight = $state(0);
	const queue: string[] = [];
	// Ids we've already started (or finished) — the dedupe guard behind `request`.
	// Reactivity-irrelevant, but a SvelteSet keeps the .svelte.ts lint-clean.
	const started = new SvelteSet<string>();

	const fetcher = kind === 'route' ? getRouteReliability : getStopReliability;
	const summarizeFor = kind === 'route' ? summarizeRoute : summarizeStop;

	function set(id: string, snap: ReliabilitySnapshot): void {
		cache.set(id, snap);
	}

	function pump(): void {
		while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
			const id = queue.shift() as string;
			inFlight++;
			set(id, { ...EMPTY_SNAPSHOT, phase: 'loading' });
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			void (fetcher as (x: string) => Promise<any>)(id)
				.then((file) => {
					set(id, summarizeFor(file));
				})
				.catch(() => {
					// Fail-soft: any error (incl. a non-404 network/parse failure) becomes
					// a terminal no-data state. The row shows no badge, never an error.
					set(id, NO_DATA_SNAPSHOT);
				})
				.finally(() => {
					inFlight--;
					pump();
				});
		}
	}

	function request(target: ReliabilityTarget): void {
		const id = targetId(target);
		if (!id || started.has(id)) return;
		started.add(id);
		// Explicitly-absent (known === false): skip the probe and resolve straight
		// to no-data. `undefined`/`true` keep the legacy fetch (pre-flag snapshots
		// + routes that do have history). Does NOT touch the fail-soft 404 path.
		if (targetKnown(target) === false) {
			set(id, NO_DATA_SNAPSHOT);
			return;
		}
		queue.push(id);
		pump();
	}

	function get(id: string): ReliabilitySnapshot {
		// Reading the SvelteMap subscribes this read to that id's entry.
		return cache.get(id) ?? EMPTY_SNAPSHOT;
	}

	// A Svelte action: fetch the row's id once it is actually on screen. Falls
	// back to an immediate request where IntersectionObserver is unavailable
	// (SSR / older test env), so the badge still loads — just without the
	// viewport gate.
	function reliability(node: Element, target: ReliabilityTarget): { destroy(): void } {
		if (typeof IntersectionObserver === 'undefined') {
			request(target);
			return { destroy() {} };
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						request(target);
						io.disconnect();
						break;
					}
				}
			},
			// A small rootMargin pre-warms rows just below the fold so the badge is
			// usually present by the time the row is fully visible.
			{ rootMargin: '200px' },
		);
		io.observe(node);
		return {
			destroy() {
				io.disconnect();
			},
		};
	}

	return {
		get,
		request,
		reliability,
		get inFlight() {
			return inFlight;
		},
	};
}
