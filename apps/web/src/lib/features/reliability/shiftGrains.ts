import type { Locale } from '$lib/i18n';
import type { SeverityCode } from '$lib/v1/schemas';

const SEVERE_CRITICAL_PCT = 10;
const SEVERE_HIGH_PCT = 5;

export function severeShareToSeverity(pct: number | null): SeverityCode {
	if (pct == null) return 'watch';
	if (pct >= SEVERE_CRITICAL_PCT) return 'critical';
	if (pct >= SEVERE_HIGH_PCT) return 'high';
	return 'watch';
}

const DELAY_CRITICAL_MIN = 10;
const DELAY_HIGH_MIN = 5;

export function delayMinToSeverity(min: number | null): SeverityCode {
	if (min == null) return 'watch';
	if (min >= DELAY_CRITICAL_MIN) return 'critical';
	if (min >= DELAY_HIGH_MIN) return 'high';
	return 'watch';
}

const BUNCHED_CRITICAL_PCT = 30;
const BUNCHED_HIGH_PCT = 15;

export function bunchingToSeverity(bunchedPct: number | null | undefined): SeverityCode {
	if (bunchedPct == null) return 'watch';
	if (bunchedPct >= BUNCHED_CRITICAL_PCT) return 'critical';
	if (bunchedPct >= BUNCHED_HIGH_PCT) return 'high';
	return 'watch';
}

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
	SHARE_DOMAIN,
	COV_DOMAIN,
	OTP_TREND_MIN_SPAN,
	OTP_TREND_REFERENCE,
	otpTrendDomain,
} from './domains';

const COV_CRITICAL = 0.5;
const COV_HIGH = 0.3;

export function covToSeverity(cov: number | null | undefined): SeverityCode {
	if (cov == null) return 'watch';
	if (cov >= COV_CRITICAL) return 'critical';
	if (cov >= COV_HIGH) return 'high';
	return 'watch';
}

export const SHIFT_GRAIN_ORDER = ['am_peak', 'midday', 'pm_peak', 'evening', 'night'] as const;
export type ShiftGrain = (typeof SHIFT_GRAIN_ORDER)[number];

export const DAY_TYPE_GRAIN_ORDER = ['weekday', 'weekend'] as const;
export type DayTypeGrain = (typeof DAY_TYPE_GRAIN_ORDER)[number];

export const SHIFT_GRAINS: ReadonlySet<string> = new Set(SHIFT_GRAIN_ORDER);
export const DAY_TYPE_GRAINS: ReadonlySet<string> = new Set(DAY_TYPE_GRAIN_ORDER);

export const isShiftGrain = (grain: string): grain is ShiftGrain => SHIFT_GRAINS.has(grain);
export const isDayTypeGrain = (grain: string): grain is DayTypeGrain => DAY_TYPE_GRAINS.has(grain);

export const SHIFT_LABELS: Record<ShiftGrain, Record<Locale, string>> = {
	am_peak: { fr: 'Pointe AM', en: 'AM peak' },
	midday: { fr: 'Journée', en: 'Midday' },
	pm_peak: { fr: 'Pointe PM', en: 'PM peak' },
	evening: { fr: 'Soirée', en: 'Evening' },
	night: { fr: 'Nuit', en: 'Night' },
};

export const DAY_TYPE_LABELS: Record<DayTypeGrain, Record<Locale, string>> = {
	weekday: { fr: 'Semaine', en: 'Weekday' },
	weekend: { fr: 'Fin de semaine', en: 'Weekend' },
};

export const SHIFT_LABELS_SHORT: Record<ShiftGrain, Record<Locale, string>> = {
	am_peak: { fr: 'AM', en: 'AM' },
	midday: { fr: 'Jour', en: 'Mid' },
	pm_peak: { fr: 'PM', en: 'PM' },
	evening: { fr: 'Soir', en: 'Eve' },
	night: { fr: 'Nuit', en: 'Night' },
};

export function shiftLabel(grain: string, locale: Locale): string {
	return isShiftGrain(grain) ? SHIFT_LABELS[grain][locale] : grain;
}

export function shiftLabelShort(grain: string, locale: Locale): string {
	return isShiftGrain(grain) ? SHIFT_LABELS_SHORT[grain][locale] : grain;
}

export function dayTypeLabel(grain: string, locale: Locale): string {
	return isDayTypeGrain(grain) ? DAY_TYPE_LABELS[grain][locale] : grain;
}

export const ISO_WEEKDAY_LABELS: Record<number, Record<Locale, string>> = {
	1: { fr: 'Lundi', en: 'Monday' },
	2: { fr: 'Mardi', en: 'Tuesday' },
	3: { fr: 'Mercredi', en: 'Wednesday' },
	4: { fr: 'Jeudi', en: 'Thursday' },
	5: { fr: 'Vendredi', en: 'Friday' },
	6: { fr: 'Samedi', en: 'Saturday' },
	7: { fr: 'Dimanche', en: 'Sunday' },
};

export function weekdayLabel(iso: number, locale: Locale): string {
	return ISO_WEEKDAY_LABELS[iso]?.[locale] ?? `${iso}`;
}
