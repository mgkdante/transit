// offenderLadder — the S14 repeat-offenders worst-N recurrence lollipop (A13).
//
// The selectHotspotLadder analog, specialized to the per-entity (trip|vehicle)
// recurrence ladder. The S14 by_grain contract delivers each grain's `entries`
// already ranked worst-first by the not-severe Wilson LOWER bound of the
// severe-observation rate (DECISIONS D3), each carrying {severe_pct,
// observation_count, wilson_lo, wilson_hi, recurrence_days, observed_days, ...}. The
// bar encodes `severe_pct` on SEVERE_DOMAIN [0,100] — the RANK variable itself,
// always >= 0. The DB order is PRESERVED (preRanked → no re-sort); recurrence_days
// is EVIDENCE, surfaced in the per-row note, never the rank.
//
// Worst-N truncation is a DISPLAY cap: the FULL ranked set fixes the absolute domain,
// then we slice to N — a smaller N shows fewer rows of the SAME bars, never rescaled
// ones. Each row carries a drill href to its route page + evidence (n, Wilson CI
// flipped onto the bar scale, a compact recurrence note). Honest absence when the
// grain serves no ranked entry.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, MagnitudeBarsSpec, MagnitudeDatum } from '$lib/components/dataviz/chart';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import { severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import type { RepeatOffenderEntry } from '$lib/v1/schemas';

/** Localized labels + link/note builders the pure selector needs (no runes here). */
export interface OffenderLadderLabels {
	/** Accessible name for the ladder (e.g. "Worst trips · severe-delay rate"). */
	title: string;
	/** Value-axis (x) title — the severe-delay rate the bar encodes. */
	xLabel: string;
	/** Value unit suffix (e.g. "%"). */
	unit: string;
	/** Wilson-interval label (e.g. "95% CI") — surfaces the per-row CI in the tooltip + sr-table. */
	ciLabel: string;
	/** Per-row evidence note builder (e.g. "late-prone on 5 of 7 observed days · n=210"). */
	note: (e: RepeatOffenderEntry) => string;
	/** Fallback label for an entity the pipeline published without a name (just the id). */
	unnamed: (e: RepeatOffenderEntry) => string;
	/** Build the drill link for an entity (its offending route); null when no route maps. */
	href: (e: RepeatOffenderEntry) => string | null;
}

export interface OffenderLadderResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	/** The full ranked count (before the worst-N truncation) — for the honest heading. */
	total: number;
	/** How many rows the spec actually carries (≤ cap). */
	shown: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

// The bar encodes the SEVERE rate, but the contract's wilson_lo/hi bracket the
// COMPLEMENTARY not-severe rate (the ranking key). Flip the interval onto the severe
// scale, [100 − wilson_hi, 100 − wilson_lo], so the displayed CI brackets the bar's
// value honestly instead of sitting on the opposite end of the axis. Null on either
// missing bound (honest absence); width is preserved (the flip is just 100 − x).
const severeCiLo = (e: RepeatOffenderEntry): number | null =>
	e.wilson_lo != null && e.wilson_hi != null ? round1(100 - e.wilson_hi) : null;
const severeCiHi = (e: RepeatOffenderEntry): number | null =>
	e.wilson_lo != null && e.wilson_hi != null ? round1(100 - e.wilson_lo) : null;

/**
 * Build the worst-N recurrence ladder spec for ONE grain's ranked `entries`.
 *
 * @param entries the grain's DB-ranked (Wilson-LB, worst-first) per-kind entries.
 * @param cap     the worst-N slice cap (Infinity for 'all'); a DISPLAY truncation only.
 */
export function selectOffenderLadder(
	entries: readonly RepeatOffenderEntry[],
	cap: number,
	locale: Locale,
	labels: OffenderLadderLabels,
): OffenderLadderResult {
	// The FULL ranked set fixes the domain frame; the DB Wilson-LB order is kept verbatim
	// (preRanked — never re-sorted). Then truncate to the display cap.
	const total = entries.length;
	const top = entries.slice(0, Math.max(0, cap));
	const shown = top.length;

	if (shown === 0) {
		return {
			spec: {
				kind: 'absence',
				title: labels.title,
				locale,
				reason: 'no-observations',
				variant: 'block',
			},
			total,
			shown,
		};
	}

	const rows: MagnitudeDatum[] = top.map((e) => {
		const href = labels.href(e);
		return {
			key: `${e.type}-${e.id}-${e.route ?? ''}`,
			label: e.route_name ?? labels.unnamed(e),
			// the RANK variable: severe-delay rate %, always >= 0 (null → honest no-data swatch).
			value: e.severe_pct ?? null,
			severity: severeShareToSeverity(e.severe_pct ?? null),
			n: e.observation_count ?? null,
			// CI flipped onto the bar's (severe-rate) scale so it brackets the value (see helpers).
			wilsonLo: severeCiLo(e),
			wilsonHi: severeCiHi(e),
			note: labels.note(e),
			...(href ? { href } : {}),
		};
	});

	return {
		spec: {
			kind: 'magnitude-bars',
			mark: 'lollipop',
			title: labels.title,
			locale,
			domain: SEVERE_DOMAIN,
			unit: labels.unit,
			xLabel: labels.xLabel,
			ciLabel: labels.ciLabel,
			rows,
			// The DB already ranked worst-first by the not-severe Wilson lower bound — keep it.
			sort: 'given',
			scale: 'severity',
		},
		total,
		shown,
	};
}
