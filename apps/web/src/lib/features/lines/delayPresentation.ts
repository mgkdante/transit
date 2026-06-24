// delayPresentation.ts — shared delay-reading helpers for the Lines surface
// (slice-S6 de-monolith). The current-buses roster (RouteDetail) and the
// directions live readout (LineDirections) both band a vehicle/stop delay to a
// calm-by-default dataviz STATUS tone + a plain-language reading; centralising
// them here keeps the two consumers honest and identical instead of each
// hand-rolling the same thresholds (the prior in-component duplication).
//
// DOCTRINE (calm-by-default, honesty): early / on-time read CALM (a blue/green
// STATUS tone, never the problem-severity scale); a null delay is "no data",
// never a fabricated 0. The COLOUR channel is the status scale; the a11y
// severity band is keyed off LATENESS only so an early bus is never announced
// 'critical'. The visible "no data" text carries the honesty for a null delay.

import type { SeverityCode } from '$lib/v1';

/** Calm-by-default status tone for a delay reading. */
export type DelayTone = 'none' | 'early' | 'on-time' | 'late' | 'severe';

/**
 * Band a delay (minutes) to a dataviz STATUS tone: early (< 0) / on-time (= 0) /
 * late (> 0) / severe (≥ 5). A null/absent delay → 'none' (no-data track).
 */
export function delayTone(delay: number | null | undefined): DelayTone {
	if (delay == null) return 'none';
	if (delay < 0) return 'early';
	if (delay >= 5) return 'severe';
	if (delay > 0) return 'late';
	return 'on-time';
}

const TONE_VAR: Record<DelayTone, string | undefined> = {
	early: 'var(--dataviz-status-early)',
	'on-time': 'var(--dataviz-status-on-time)',
	late: 'var(--dataviz-status-late)',
	severe: 'var(--dataviz-status-severe)',
	none: undefined,
};

/** The `var(--dataviz-status-*)` fill for a delay (undefined → no-data track). */
export function delayColorVar(delay: number | null | undefined): string | undefined {
	return TONE_VAR[delayTone(delay)];
}

/**
 * The a11y severity band a SeverityBar announces — keyed off LATENESS only, so an
 * early / on-time / null-delay reading stays calm ('watch', the lowest band),
 * never 'critical' / 'high'. Visible colour comes from delayColorVar, not this.
 */
export function delaySeverity(delay: number | null | undefined): SeverityCode {
	if (delay == null || delay <= 0) return 'watch';
	return delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
}

/** Locale copy fns the plain-language delay reading needs. */
export interface DelayLabelCopy {
	readonly early: (minutes: number) => string;
	readonly late: (minutes: number) => string;
	readonly onTime: string;
	readonly noDelay: string;
}

/**
 * Plain-language reading of a delay: early / on time / N min late, or the copy's
 * "no delay" phrase when the feed omits it. NEVER a fabricated 0 — a null delay
 * reads the explicit no-delay copy, not "0 min".
 */
export function delayLabel(delay: number | null | undefined, copy: DelayLabelCopy): string {
	if (delay == null) return copy.noDelay;
	if (delay < 0) return copy.early(delay);
	if (delay > 0) return copy.late(delay);
	return copy.onTime;
}
