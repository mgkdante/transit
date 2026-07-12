// selectHotspotLadder — the S12 hotspots worst-N accountability lollipop (A13).
//
// The selectWeakStops analog, generalized to the CROSS-KIND hotspots ladder. The S12
// by_grain contract delivers each grain's `entries` already ranked worst-first by the
// SAME not-severe Wilson LOWER bound for BOTH route and stop cells (DECISIONS WEB1),
// each carrying {severe_pct, observation_count, wilson_lo, wilson_hi, ...}. The bar
// encodes `severe_pct` on SEVERE_DOMAIN [0,100] — the RANK variable itself, always
// >= 0 — so a genuinely-worst cell whose pooled OTP delta is <= 0 still draws an
// honest bar. The DB order is PRESERVED (preRanked → no re-sort); otp_delta_pts is a
// DISPLAY/evidence field only, never the rank.
//
// Worst-N truncation is a DISPLAY cap (WEB3): the FULL ranked set fixes the absolute
// domain, then we slice to N — a smaller N shows fewer rows of the SAME bars, never
// rescaled ones. Each row carries a drill href to its route/stop page + evidence
// (n, Wilson CI flipped onto the bar scale, a compact note). Honest absence when the
// grain serves no ranked entry.

import type { Locale } from '$lib/i18n';
import type {
	AbsenceSpec,
	ChartDatumPopoverModel,
	MagnitudeBarsSpec,
	MagnitudeDatum,
} from '$lib/components/dataviz/chart';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import { severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import type { HotspotEntry } from '$lib/v1/schemas';

export interface HotspotPopoverEvidence {
	readonly wilsonLo: number | null;
	readonly wilsonHi: number | null;
}

/** Localized labels + link/note builders the pure selector needs (no runes here). */
export interface HotspotLadderLabels {
	/** Accessible name for the ladder (e.g. "Worst spots · severe-delay rate"). */
	title: string;
	/** Value-axis (x) title — the severe-delay rate the bar encodes. */
	xLabel: string;
	/** Value unit suffix (e.g. "%"). */
	unit: string;
	/** Wilson-interval label (e.g. "95% CI") — surfaces the per-row CI in the tooltip + sr-table. */
	ciLabel: string;
	/** Per-row evidence note builder (e.g. "severe 42% · avg 3.1 min · n=987"). */
	note: (e: HotspotEntry) => string;
	/** Fallback label for a cell the pipeline published without a name (just the id). */
	unnamed: (id: string) => string;
	/** Build the drill link for a cell (route/stop); null when its type maps to no page. */
	href: (e: HotspotEntry) => string | null;
	tapPopover: (
		entry: HotspotEntry,
		href: string | null,
		evidence: HotspotPopoverEvidence,
	) => ChartDatumPopoverModel;
}

export interface HotspotLadderResult {
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
const severeCiLo = (e: HotspotEntry): number | null =>
	e.wilson_lo != null && e.wilson_hi != null ? round1(100 - e.wilson_hi) : null;
const severeCiHi = (e: HotspotEntry): number | null =>
	e.wilson_lo != null && e.wilson_hi != null ? round1(100 - e.wilson_lo) : null;

/**
 * Build the worst-N ladder spec for ONE grain's ranked `entries`.
 *
 * @param entries the grain's DB-ranked (Wilson-LB, worst-first) cross-kind entries.
 * @param cap     the worst-N slice cap (Infinity for 'all'); a DISPLAY truncation only.
 */
export function selectHotspotLadder(
	entries: readonly HotspotEntry[],
	cap: number,
	locale: Locale,
	labels: HotspotLadderLabels,
): HotspotLadderResult {
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
		const wilsonLo = severeCiLo(e);
		const wilsonHi = severeCiHi(e);
		return {
			key: `${e.type}-${e.id}`,
			label: e.name ?? labels.unnamed(e.id),
			// the RANK variable: severe-delay rate %, always >= 0 (null → honest no-data swatch).
			value: e.severe_pct ?? null,
			severity: severeShareToSeverity(e.severe_pct ?? null),
			n: e.observation_count ?? null,
			// CI flipped onto the bar's (severe-rate) scale so it brackets the value (see helpers).
			wilsonLo,
			wilsonHi,
			note: labels.note(e),
			tapPopover: labels.tapPopover(e, href, { wilsonLo, wilsonHi }),
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
