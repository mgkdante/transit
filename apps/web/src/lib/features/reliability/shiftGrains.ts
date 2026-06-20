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
