// serviceWindow.ts — pure, provider-agnostic inference for HONEST ABSENCE.
//
// When live data is absent, we INFER and STATE the specific reason from data we
// already hold — never a silent stand-down, never a generic no-data, never a
// fabricated reason. This module is the pure brain behind that: it never reads a
// clock, never fetches, never touches the DOM. Callers pass `now` (minutes since
// midnight in the provider display zone, via utils/time.minutesSinceMidnight) so
// the functions stay deterministic + unit-testable.
//
// Two pure functions:
//   serviceWindowState(first, last, now) → where NOW sits in the service window.
//   inferAbsenceReason(signals)          → the localized reason KEY + params, or
//                                          null when no reason is derivable (the
//                                          caller then falls back to a plain
//                                          honest no-data message).
//
// HONESTY: only a reason the data supports is returned. The metro reason needs
// BOTH route_type 1 AND the metro_realtime gap. A "closed" verdict needs a real
// service window. "Silent" needs the within-window + non-responding signal. When
// none hold, the result is null (no fabricated reason).

/** GTFS route_type for metro/subway. */
export const ROUTE_TYPE_METRO = 1;

/** The provenance gap string that marks "no realtime is published for the metro". */
export const METRO_REALTIME_GAP = 'metro_realtime';

/**
 * Where NOW sits relative to a service window.
 *   open        — within the window (live silence is meaningful → maybe "silent").
 *   before-open — same calendar day, before first departure (opens later today).
 *   overnight   — a wrapping window (last < first) and now is in the dead gap
 *                 between last night's end and this morning's first departure.
 *   closed      — a same-day window and now is past last departure.
 *   unknown     — the window could not be parsed (missing/garbage times).
 */
export type ServiceWindowState = 'open' | 'before-open' | 'overnight' | 'closed' | 'unknown';

/** Parse a bare "HH:MM" wall-clock string to minutes-since-midnight, or null. */
export function parseWallClockMinutes(value: string | null | undefined): number | null {
	if (value == null) return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!m) return null;
	const hour = Number.parseInt(m[1], 10);
	const minute = Number.parseInt(m[2], 10);
	if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
	// Accept 00:00..23:59. A wall-clock display value is already GTFS-normalised
	// (>=24:00 folded), so anything outside this range is not a usable window.
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return hour * 60 + minute;
}

/**
 * Classify where `now` (minutes since midnight, provider zone) sits in the
 * service window bounded by `first`/`last` (HH:MM wall-clock strings).
 *
 * Window math:
 *   - both bounds must parse, else 'unknown' (we never claim closed on no data).
 *   - last >= first  → NO midnight wrap: open iff first <= now <= last;
 *                      now < first → 'before-open'; now > last → 'closed'.
 *   - last <  first  → wraps past midnight (e.g. 05:11 → 01:17): open iff
 *                      now >= first OR now <= last; otherwise the dead gap
 *                      (last < now < first) → 'overnight'.
 */
export function serviceWindowState(
	first: string | null | undefined,
	last: string | null | undefined,
	now: number,
): ServiceWindowState {
	const firstMin = parseWallClockMinutes(first);
	const lastMin = parseWallClockMinutes(last);
	if (firstMin == null || lastMin == null || Number.isNaN(now)) return 'unknown';

	if (lastMin >= firstMin) {
		// No wrap — a same-calendar-day window.
		if (now < firstMin) return 'before-open';
		if (now > lastMin) return 'closed';
		return 'open';
	}

	// Wraps past midnight: open in the two tails [first, 24:00) ∪ [00:00, last].
	if (now >= firstMin || now <= lastMin) return 'open';
	// In the dead gap between last night's close and this morning's open.
	return 'overnight';
}

/**
 * Derive a stop's service window (first/last departure as HH:MM wall-clock) from
 * its raw GTFS schedule times.
 *
 * `times` are raw GTFS local strings ("HH:MM" or "HH:MM:SS"), and GTFS allows
 * past-midnight service expressed as >= 24:00 (e.g. "25:30" = 01:30 next day).
 * We map each to absolute GTFS minutes, take the earliest + latest, then fold to
 * wall-clock HH:MM (mod 1440). When the latest crosses 24:00 (overnight service)
 * the returned window naturally wraps (last < first), which serviceWindowState
 * already handles.
 *
 * Returns null when no time parses (no window we can claim closed against).
 */
export function stopServiceWindow(
	times: readonly string[] | null | undefined,
): { first: string; last: string } | null {
	if (!times || times.length === 0) return null;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const raw of times) {
		const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
		if (!m) continue;
		const hour = Number.parseInt(m[1], 10);
		const minute = Number.parseInt(m[2], 10);
		if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) continue;
		const abs = hour * 60 + minute; // GTFS minutes; hour may be >= 24
		if (abs < min) min = abs;
		if (abs > max) max = abs;
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
	const toHm = (abs: number): string => {
		const wall = ((abs % 1440) + 1440) % 1440;
		const h = Math.floor(wall / 60);
		const mm = wall % 60;
		return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
	};
	return { first: toHm(min), last: toHm(max) };
}

/**
 * The localized reason an inferred absence resolves to. `key` selects the copy
 * block; `firstDeparture` is the HH:MM string to interpolate for the open/close
 * variants. `lastSeenIso` carries a vehicle's last-report time for the "silent
 * selected bus" map case (caller renders it as a relative age).
 */
export type AbsenceReasonKey =
	| 'metro-no-realtime' // route_type 1 + metro_realtime gap — no live positions published
	| 'closed-opens-at' // same-day window, past close — opens at FIRST
	| 'overnight-opens-at' // overnight gap — no service at this hour, opens at FIRST
	| 'before-open' // same day, before first departure — opens at FIRST
	| 'scheduled-silent' // within window but no live vehicle is reporting
	| 'last-seen'; // a selected vehicle that has gone quiet (map) — last seen N ago

export interface AbsenceReason {
	readonly key: AbsenceReasonKey;
	/** First-departure HH:MM, for the opens-at/before-open variants. */
	readonly firstDeparture?: string;
	/** A vehicle's last-report ISO timestamp, for the last-seen (map) variant. */
	readonly lastSeenIso?: string;
}

/** The signals the inference draws on — all optional; absence narrows the verdict. */
export interface AbsenceSignals {
	/** GTFS route_type of the route this absence is about (null when unknown). */
	readonly routeType?: number | null;
	/** provenance.gaps — declared data gaps (e.g. ["metro_realtime"]). */
	readonly gaps?: readonly string[] | null;
	/** First departure HH:MM (provider wall-clock) — drives the service window. */
	readonly firstDeparture?: string | null;
	/** Last departure HH:MM (provider wall-clock) — may wrap past midnight. */
	readonly lastDeparture?: string | null;
	/** NOW as minutes-since-midnight in the provider display zone. */
	readonly nowMinutes?: number | null;
	/**
	 * True when the LIVE feed reports this route/stop as scheduled-but-silent (no
	 * live vehicle): from network.non_responding / non_responding_by_route. Only
	 * meaningful inside an open window.
	 */
	readonly nonResponding?: boolean;
	/** A selected vehicle's last-report ISO time (map: a silent selected bus). */
	readonly lastSeenIso?: string | null;
}

/**
 * Infer the SPECIFIC reason live data is absent, or null when none is derivable.
 *
 * Precedence (most-specific, most-certain first):
 *   1. metro-no-realtime — route_type 1 AND the metro_realtime gap is declared.
 *      The strongest, structural reason: the feed simply never carries metro
 *      positions. Stated ONLY when BOTH hold (never for a bus, never on a metro
 *      route without the declared gap).
 *   2. last-seen — a selected vehicle has a last-report time (map case). The
 *      caller decides WHEN this applies (a chosen-but-quiet bus); we just carry
 *      the timestamp through so the message reads "last seen N ago".
 *   3. service-window — when the window parses:
 *        closed        → closed-opens-at (opens at FIRST)
 *        overnight     → overnight-opens-at (no service at this hour, opens at FIRST)
 *        before-open   → before-open (opens at FIRST)
 *        open + silent → scheduled-silent (within window, nothing reporting)
 *      An OPEN window with no non-responding signal yields NO reason here — we do
 *      not over-claim "silent" when we cannot prove the absence is a silent feed.
 *   4. otherwise → null (caller falls back to a plain honest no-data message).
 */
export function inferAbsenceReason(signals: AbsenceSignals): AbsenceReason | null {
	const { routeType, gaps, firstDeparture, lastDeparture, nowMinutes, nonResponding, lastSeenIso } =
		signals;

	// 1. Metro has no realtime — both conditions required.
	const hasMetroGap = (gaps ?? []).includes(METRO_REALTIME_GAP);
	if (routeType === ROUTE_TYPE_METRO && hasMetroGap) {
		return { key: 'metro-no-realtime' };
	}

	// 2. A selected vehicle that has gone quiet (map): carry its last-seen time.
	if (lastSeenIso != null && lastSeenIso !== '') {
		return { key: 'last-seen', lastSeenIso };
	}

	// 3. Service-window inference (only when the window + clock are known).
	if (nowMinutes != null && !Number.isNaN(nowMinutes)) {
		const state = serviceWindowState(firstDeparture, lastDeparture, nowMinutes);
		const first = firstDeparture ?? undefined;
		if (state === 'closed' && first) return { key: 'closed-opens-at', firstDeparture: first };
		if (state === 'overnight' && first) return { key: 'overnight-opens-at', firstDeparture: first };
		if (state === 'before-open' && first) return { key: 'before-open', firstDeparture: first };
		if (state === 'open' && nonResponding === true) return { key: 'scheduled-silent' };
	}

	// 4. No reason the data supports — caller falls back to plain no-data copy.
	return null;
}
