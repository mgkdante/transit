// notReportedLines — the receipt's NOT-REPORTED lines list (S13, NEW · the operator item).
//
// Consumes Receipt.service_states.not_reported_routes[] (ReceiptNotReportedRoute: id, name?,
// scheduled_trip_days) — lines that were SCHEDULED that day yet posted ZERO realtime
// observations ('silent = scheduled but never appeared', distinct from an explicitly
// CANCELLED line). Mirrors the S9 SectionReporting silent-lines list: each row is a ranked
// link to /lines/[id]; the bar rides RankedRow/SeverityBar on a FIXED absolute count domain
// (never the in-view worst).
//
// SHOWN/TOTAL HONESTY (DB4): not_reported_route_count is the PRE-cap total; not_reported_routes
// is capped (top by scheduled_trip_days, NOT_REPORTED_ROUTES_CAP=50). On a mass-outage day the
// count reads e.g. 200 while the list shows the top 50 — the VM carries both so the section can
// say "showing 50 of 200".
//
// HONEST RAMP-IN: the whole block stands DOWN (hasData=false) while GC2's scheduled-universe
// data ramps — an ABSENT list is honest-absence (AbsentValue), NEVER an empty list that would
// read as 'every line reported'.

import type { ReceiptNotReportedRoute, ReceiptServiceStates, SeverityCode } from '$lib/v1/schemas';

/**
 * The fixed absolute count domain for the not-reported scheduled-trip-day bars (never the
 * in-view worst). A line with ~20 scheduled trip-days silent ≈ a full-day line-level outage →
 * saturates the bar; a typical 1-8 reads honestly small and the same on every day. The rank +
 * the "N scheduled" display carry the precise cross-line comparison.
 */
export const NOT_REPORTED_DOMAIN: readonly [number, number] = [0, 20];

/** One not-reported line row (RankedRow-ready, links to /lines/[id]). */
export interface NotReportedRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly subtitle: string;
	readonly severity: SeverityCode;
	/** scheduled_trip_days on NOT_REPORTED_DOMAIN, or null when the count is absent. */
	readonly value: number | null;
	readonly domain: readonly [number, number];
	readonly display: string | null;
	readonly href: string;
	readonly ariaLabel: string;
}

export interface NotReportedVM {
	readonly rows: NotReportedRow[];
	/** The capped count actually shown (rows.length). */
	readonly shown: number;
	/** The PRE-cap total (not_reported_route_count), for the honest shown/total note. */
	readonly total: number | null;
	/** True when the list carries at least one line (else the section stands down). */
	readonly hasData: boolean;
}

export interface NotReportedLabels {
	/** rid → the rider-facing line name (through the unknown-data fallback). */
	readonly routeName: (id: string, fallbackName: string | null | undefined) => string;
	/** Per-row subtitle prefix ("Line"). */
	readonly rowLabel: string;
	/** rid → the localized /lines/[id] href. */
	readonly href: (id: string) => string;
	/** rid → the localized link accessible name ("View line 51"). */
	readonly viewDetail: (id: string) => string;
	/** scheduled_trip_days → localized display ("12 scheduled"), or null when absent. */
	readonly fmtScheduled: (v: number | null | undefined) => string | null;
}

/** Build the not-reported lines VM from Receipt.service_states. */
export function selectNotReportedLines(
	states: ReceiptServiceStates | null | undefined,
	labels: NotReportedLabels,
): NotReportedVM {
	const list: readonly ReceiptNotReportedRoute[] = states?.not_reported_routes ?? [];
	const rows: NotReportedRow[] = list.map((r, i) => ({
		key: r.id,
		rank: i + 1,
		title: labels.routeName(r.id, r.name),
		subtitle: labels.rowLabel,
		// A scheduled line that never appeared is a service gap → the bar reads critical.
		severity: 'critical' as SeverityCode,
		value: r.scheduled_trip_days ?? null,
		domain: NOT_REPORTED_DOMAIN,
		display: labels.fmtScheduled(r.scheduled_trip_days),
		href: labels.href(r.id),
		ariaLabel: labels.viewDetail(r.id),
	}));
	return {
		rows,
		shown: rows.length,
		total: states?.not_reported_route_count ?? null,
		hasData: rows.length > 0,
	};
}
