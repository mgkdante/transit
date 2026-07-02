// offenderLedger — the S14 legacy-fallback ranked ledger of the scalar offenders[].
//
// The FALLBACK path (DECISIONS D5): when the payload carries NO by_grain ladders (an
// OLD payload), the surface still renders the scalar offenders[] as a RankedRow
// ledger — but on the ABSOLUTE DELAY_DIST_DOMAIN [0,15], not the banned in-view
// `delay / worst` normalization. Each row's `value` is the RAW avg_delay_min; the
// caller hands RankedRow the fixed `domain`, so the bar scales against a stable
// literal and a given delay renders the same length on every refresh (doctrine-clean).
//
// Pure — no runes, no i18n context, NO $lib/nav import (that pulls $app/navigation →
// window, which the node "data" test project has not). The orchestrator supplies the
// href builder, exactly like the offenderLadder selector. severity is READ from the
// published field (DECISIONS D4: web stops re-deriving severity client-side); an
// absent/unknown severity bands to the quietest 'watch' so a no-data row never paints hot.

import type { SeverityCode, Offender } from '$lib/v1/schemas';

// The three severity bands the pipeline publishes (repeat_offender vocabulary) mapped
// onto the dataviz SeverityCode scale. The web NEVER recomputes this from the delay —
// an unknown/absent published severity bands to the quietest 'watch' (honest neutral),
// never a fabricated hot band.
const SEVERITY_MAP: Readonly<Record<string, SeverityCode>> = {
	critical: 'critical',
	high: 'high',
	watch: 'watch',
};

/** Map a published severity string to a SeverityCode; unknown/absent → 'watch'. */
export function publishedSeverity(severity: string | null | undefined): SeverityCode {
	if (severity == null) return 'watch';
	return SEVERITY_MAP[severity.toLowerCase()] ?? 'watch';
}

/** Localized copy the pure ledger selector needs (no runes / no i18n context here). */
export interface OffenderLedgerLabels {
	/** Localized mode-tag by type (route / stop / other). */
	typeLabel: (type: string) => string;
	/** Subtitle prefix for a present recurrence reading. */
	recurrenceLabel: string;
	/** Subtitle fallback when a row carries no recurrence string. */
	recurrenceUnknown: string;
	/** Format an avg-delay minute value to text (e.g. "12.4 min"); null on no-data. */
	fmtMin: (v: number | null) => string | null;
	/** Accessible label for a row that links into its detail page. */
	viewDetail: (title: string) => string;
	/** Build the drill href for an offender (the orchestrator owns $lib/nav). */
	href: (o: Offender) => string;
}

/** One RankedRow view-model built from a scalar Offender. */
export interface OffenderLedgerRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly subtitle: string;
	readonly severity: SeverityCode;
	/** RAW avg_delay_min (real units) — the caller pairs it with the ABSOLUTE domain. */
	readonly value: number | null;
	readonly display: string | null;
	readonly href: string;
	readonly ariaLabel: string;
}

/** Localized title for one offender — its route name, then a sane fallback. */
function offenderTitle(o: Offender, typeLabel: (t: string) => string): string {
	const name = o.route_name?.trim();
	if (name) return name;
	const route = o.route?.trim();
	if (route) return `${typeLabel(o.type)} ${route}`;
	return `${typeLabel(o.type)} ${o.id}`;
}

/** Subtitle: the recurrence string (honest when absent) + the offending route id. */
function offenderSubtitle(o: Offender, labels: OffenderLedgerLabels): string {
	const recurrence = o.recurrence?.trim();
	const recurrenceText = recurrence
		? `${labels.recurrenceLabel} ${recurrence}`
		: labels.recurrenceUnknown;
	const route = o.route?.trim();
	const routeText = route && o.route_name?.trim() ? ` · ${labels.typeLabel(o.type)} ${route}` : '';
	return `${recurrenceText}${routeText}`;
}

/**
 * Build the RankedRow view-models for the legacy scalar offenders[]. The pipeline
 * already ranks the feed worst-first, so order is PRESERVED and ranks are 1-based as
 * published. `value` is the RAW avg_delay_min (the caller pairs it with the absolute
 * DELAY_DIST_DOMAIN via RankedRow's `domain` prop — never an in-view /worst quotient).
 * The href is built by the caller's `labels.href` (the orchestrator owns $lib/nav).
 */
export function buildOffenderLedger(
	list: readonly Offender[],
	labels: OffenderLedgerLabels,
): OffenderLedgerRow[] {
	return list.map((o, i) => {
		const title = offenderTitle(o, labels.typeLabel);
		const delay = o.avg_delay_min ?? null;
		return {
			// Composite key over the (type, id, route) accountability unit — the SAME
			// offender id can legitimately appear on two routes (one vehicle, two lines),
			// so the route disambiguates the unit and keeps the {#each} reconciler stable.
			key: `${o.type}:${o.id}:${o.route ?? ''}`,
			rank: i + 1,
			title,
			subtitle: offenderSubtitle(o, labels),
			// DECISIONS D4: use the PUBLISHED severity, never a client re-derivation.
			severity: publishedSeverity(o.severity),
			value: delay,
			display: labels.fmtMin(delay),
			href: labels.href(o),
			ariaLabel: labels.viewDetail(title),
		};
	});
}
