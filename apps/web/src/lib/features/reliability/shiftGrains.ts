// shiftGrains.ts — the canonical time-of-day SHIFT + DAY-TYPE grain vocabulary
// shared by every historic reliability surface (lines + stops).
//
// The pipeline emits, ALONGSIDE the calendar grains (day/week/month), two extra
// grain families on the same periods[] array:
//   - SHIFT grains   — am_peak / midday / pm_peak / evening / night
//                      (gold.route_delay_by_shift / stop equivalent), date:null.
//   - DAY-TYPE grains — weekday / weekend
//                      (gold.route_delay_by_daytype), date:null.
//
// These are a trailing-window observation-weighted proxy, NOT certified OTP, so
// every consumer must print that caveat. This module is the SINGLE source of the
// token sets, their canonical order, and their localized labels so the lines and
// stops surfaces speak identical vocabulary (no re-invented tokens, no drift).
//
// Pure data + pure functions; no DOM, no i18n context — SSR-safe.

import type { Locale } from '$lib/i18n';
import type { SeverityCode } from '$lib/v1/schemas';

// ── Severe-share severity banding ────────────────────────────────────────────
// A severe-delay share is itself a severity reading: the ranked reliability
// surfaces (network by_shift/by_daytype, lines Cluster01, stops StopDetail) all
// band the same percentage thresholds so the SeverityBar/RankedRow colour stays
// honest and consistent. This is the SINGLE source of those thresholds (was
// inlined verbatim 3×). The input is a percentage (0..100); null bands to the
// quietest 'watch' (a no-data row never reads as a hot 'critical').

/** Threshold (severe-share %) at or above which a grain bands to 'critical'. */
const SEVERE_CRITICAL_PCT = 10;
/** Threshold (severe-share %) at or above which a grain bands to 'high'. */
const SEVERE_HIGH_PCT = 5;

/**
 * Band a severe-delay share (percentage, 0..100) onto the dataviz SeverityCode
 * scale: >=10% critical, >=5% high, else watch. A null share (no data) bands to
 * the quietest 'watch' so an absent reading never paints as a hot severity.
 */
export function severeShareToSeverity(pct: number | null): SeverityCode {
	if (pct == null) return 'watch';
	if (pct >= SEVERE_CRITICAL_PCT) return 'critical';
	if (pct >= SEVERE_HIGH_PCT) return 'high';
	return 'watch';
}

/** Threshold (avg-delay minutes) at or above which a stop bands to 'critical'. */
const DELAY_CRITICAL_MIN = 10;
/** Threshold (avg-delay minutes) at or above which a stop bands to 'high'. */
const DELAY_HIGH_MIN = 5;

/**
 * Band an avg-delay reading (minutes) onto the SeverityCode scale: >=10 min
 * critical, >=5 min high, else watch. A SEPARATE semantic table from the
 * severe-share cutoffs (which take a %, not minutes) — they coincide numerically at
 * 10/5 but mean different things. null (no data) bands to the quietest 'watch' so an
 * absent reading never paints hot. (DRY: was inlined in §01's weak-stops list.)
 */
export function delayMinToSeverity(min: number | null): SeverityCode {
	if (min == null) return 'watch';
	if (min >= DELAY_CRITICAL_MIN) return 'critical';
	if (min >= DELAY_HIGH_MIN) return 'high';
	return 'watch';
}

/** Threshold (bunched %) at or above which a shift's regularity bands to 'critical'. */
const BUNCHED_CRITICAL_PCT = 30;
/** Threshold (bunched %) at or above which it bands to 'high'. */
const BUNCHED_HIGH_PCT = 15;

/**
 * Band a bunching share (percentage, 0..100) onto the SeverityCode scale: >=30%
 * critical, >=15% high, else watch. null (no data) bands to the quietest 'watch'.
 * (DRY: was §02 Wait/Regularity's inline severityFor.)
 */
export function bunchingToSeverity(bunchedPct: number | null | undefined): SeverityCode {
	if (bunchedPct == null) return 'watch';
	if (bunchedPct >= BUNCHED_CRITICAL_PCT) return 'critical';
	if (bunchedPct >= BUNCHED_HIGH_PCT) return 'high';
	return 'watch';
}

// The fixed, absolute chart domains now live in their own structural module (grouped by unit,
// each justified) — see ./domains. Re-exported here so the existing reliability-vocabulary
// import path (`from '$lib/features/reliability/shiftGrains'`) keeps resolving them; ./domains
// is the single source of truth. Percentages are ALL [0,100]; no per-chart inline scales.
export {
	DELAY_STOP_DOMAIN,
	DELAY_POS_DOMAIN,
	DELAY_DIST_DOMAIN,
	DELAY_DOW_DOMAIN,
	SEVERE_DOMAIN,
	OTP_DOMAIN,
	HEADWAY_DOMAIN,
	BUNCHED_DOMAIN,
	CANCEL_RATE_DOMAIN,
	SKIPPED_RATE_DOMAIN,
	COV_DOMAIN,
} from './domains';

/** CoV (gap stddev / mean) at or above which regularity bands to critical. */
const COV_CRITICAL = 0.5;
/** CoV at or above which it bands to high. */
const COV_HIGH = 0.3;

/**
 * Band a headway coefficient-of-variation onto the SeverityCode scale: >=0.5
 * critical, >=0.3 high, else watch. null (no data) bands to the quietest 'watch'.
 */
export function covToSeverity(cov: number | null | undefined): SeverityCode {
	if (cov == null) return 'watch';
	if (cov >= COV_CRITICAL) return 'critical';
	if (cov >= COV_HIGH) return 'high';
	return 'watch';
}

/** The time-of-day shift grains, in canonical chronological order (AM → night). */
export const SHIFT_GRAIN_ORDER = ['am_peak', 'midday', 'pm_peak', 'evening', 'night'] as const;
export type ShiftGrain = (typeof SHIFT_GRAIN_ORDER)[number];

/** The day-type grains, in canonical order (weekday before weekend). */
export const DAY_TYPE_GRAIN_ORDER = ['weekday', 'weekend'] as const;
export type DayTypeGrain = (typeof DAY_TYPE_GRAIN_ORDER)[number];

/** Membership set for the time-of-day shift grains (gold.route_delay_by_shift). */
export const SHIFT_GRAINS: ReadonlySet<string> = new Set(SHIFT_GRAIN_ORDER);
/** Membership set for the day-type grains (gold.route_delay_by_daytype). */
export const DAY_TYPE_GRAINS: ReadonlySet<string> = new Set(DAY_TYPE_GRAIN_ORDER);

/** True when `grain` is one of the time-of-day shift grains. */
export const isShiftGrain = (grain: string): grain is ShiftGrain => SHIFT_GRAINS.has(grain);
/** True when `grain` is one of the day-type grains. */
export const isDayTypeGrain = (grain: string): grain is DayTypeGrain => DAY_TYPE_GRAINS.has(grain);

/** Bilingual shift-grain labels — the EN/FR transit vocabulary (FR canonical). */
export const SHIFT_LABELS: Record<ShiftGrain, Record<Locale, string>> = {
	am_peak: { fr: 'Pointe AM', en: 'AM peak' },
	midday: { fr: 'Journée', en: 'Midday' },
	pm_peak: { fr: 'Pointe PM', en: 'PM peak' },
	evening: { fr: 'Soirée', en: 'Evening' },
	night: { fr: 'Nuit', en: 'Night' },
};

/** Bilingual day-type labels (weekday / weekend), FR canonical. */
export const DAY_TYPE_LABELS: Record<DayTypeGrain, Record<Locale, string>> = {
	weekday: { fr: 'Semaine', en: 'Weekday' },
	weekend: { fr: 'Fin de semaine', en: 'Weekend' },
};

/** Localized label for a shift grain; an unknown grain falls back to its raw token. */
export function shiftLabel(grain: string, locale: Locale): string {
	return isShiftGrain(grain) ? SHIFT_LABELS[grain][locale] : grain;
}

/** Localized label for a day-type grain; an unknown grain falls back to its raw token. */
export function dayTypeLabel(grain: string, locale: Locale): string {
	return isDayTypeGrain(grain) ? DAY_TYPE_LABELS[grain][locale] : grain;
}

// ── ISO weekday vocabulary ───────────────────────────────────────────────────
// The per-stop / per-route weekday-seasonality surfaces carry an ISO weekday key
// (1=Mon..7=Sun, the pipeline's day_of_week_iso). Both the lines and stops
// surfaces resolve that integer to a localized day name; the labels live HERE,
// once, so the two surfaces speak the same weekday vocabulary (no re-invented or
// drifting Mon/Lun tables in each copy file).

/** Full localized weekday names indexed by ISO weekday (1=Mon..7=Sun), FR canonical. */
export const ISO_WEEKDAY_LABELS: Record<number, Record<Locale, string>> = {
	1: { fr: 'Lundi', en: 'Monday' },
	2: { fr: 'Mardi', en: 'Tuesday' },
	3: { fr: 'Mercredi', en: 'Wednesday' },
	4: { fr: 'Jeudi', en: 'Thursday' },
	5: { fr: 'Vendredi', en: 'Friday' },
	6: { fr: 'Samedi', en: 'Saturday' },
	7: { fr: 'Dimanche', en: 'Sunday' },
};

/**
 * Localized full weekday name for an ISO weekday (1=Mon..7=Sun). An out-of-range
 * integer falls back to its own string (e.g. `8` → "8") so a malformed key is
 * never silently mapped to a real day.
 */
export function weekdayLabel(iso: number, locale: Locale): string {
	return ISO_WEEKDAY_LABELS[iso]?.[locale] ?? `${iso}`;
}
