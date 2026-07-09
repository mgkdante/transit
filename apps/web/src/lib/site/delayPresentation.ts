// delayPresentation.ts — the SITE-WIDE shared delay-reading helpers (promoted out
// of features/lines in S6). Every surface that bands a vehicle/stop delay to a
// dataviz STATUS tone + a plain-language reading reuses these instead of
// hand-rolling the same thresholds: the lines roster (RouteDetail) + directions
// (LineDirections), TripDetail, StopDetail, and the map selection detail
// (mapSelectionDetail.logic). One source of truth for the thresholds + the
// five-value data-tone contract (none/early/on-time/late/severe).
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

/**
 * Locale copy fns the plain-language delay reading needs. `early`/`late` receive
 * the RAW signed delay (so each copy abs-es internally for the "early" wording).
 * `noDelay` is OPTIONAL: surfaces that treat an absent delay as "no data" supply
 * it (the live roster / trip view); surfaces that treat absent as "on time" (a
 * scheduled departure board with no realtime delta) OMIT it and fall back to
 * `onTime`. Known-only callers (the map, where absence renders AbsentValue
 * instead) never hit the null branch, so they too can omit it.
 */
export interface DelayLabelCopy {
	readonly early: (minutes: number) => string;
	readonly late: (minutes: number) => string;
	readonly onTime: string;
	readonly noDelay?: string;
}

/**
 * Plain-language reading of a delay: early / on time / N min late. A null/absent
 * delay reads `noDelay` when supplied, else falls back to `onTime` — NEVER a
 * fabricated 0 / "0 min".
 */
export function delayLabel(delay: number | null | undefined, copy: DelayLabelCopy): string {
	if (delay == null) return copy.noDelay ?? copy.onTime;
	if (delay < 0) return copy.early(delay);
	if (delay > 0) return copy.late(delay);
	return copy.onTime;
}

// ── Departure-row glyph + tone helpers (shared board presentation) ────────────
// The live-departures board (StopDetail) and the reusable ScheduleTable both tint
// a departure row by its delay tone AND carry a redundant glyph (Chart Doctrine:
// colour is NEVER the only channel). Promoted here so the two renderers read ONE
// source of truth instead of forking the mapping.

/** The four FILTERABLE, non-null delay tones (a null delay rides the 'none' track). */
export type ChipTone = Exclude<DelayTone, 'none'>;

/**
 * A departure's tone — a null/absent delay is an ABSENT realtime delta, NOT an
 * on-time claim: it rides the 'none' no-data track (no fill, no glyph).
 */
export function depTone(delay: number | null | undefined): DelayTone {
	return delay == null ? 'none' : delayTone(delay);
}

/**
 * Redundant glyph per tone (Chart Doctrine: colour is NEVER the only channel).
 * ▲ = behind schedule (late/severe), ▼ = ahead (early), ● = on time.
 */
export const TONE_GLYPH: Record<ChipTone, string> = {
	early: '▼',
	'on-time': '●',
	late: '▲',
	severe: '▲',
};

/**
 * A representative signed delay per tone. Drives the SHARED delayColorVar so the
 * chip glyphs + row captions resolve the ONE status scale — on-time always
 * resolves (unlike a raw null → no-data track).
 */
export const TONE_SAMPLE: Record<ChipTone, number> = {
	early: -1,
	'on-time': 0,
	late: 1,
	severe: 5,
};

/** The `--dataviz-status-*` fill for a non-null tone (chip glyphs + row captions). */
export function toneColorVar(tone: ChipTone): string | undefined {
	return delayColorVar(TONE_SAMPLE[tone]);
}

/** A row's glyph — 'none' rows render muted (no glyph, honest absence). */
export function rowGlyph(tone: DelayTone): string {
	return tone === 'none' ? '' : TONE_GLYPH[tone];
}

/** A row's status fill — 'none' rows render muted (no fill, honest absence). */
export function rowColorVar(tone: DelayTone): string | undefined {
	return tone === 'none' ? undefined : toneColorVar(tone);
}
