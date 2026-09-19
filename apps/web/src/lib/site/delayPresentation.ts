import type { SeverityCode } from '$lib/v1';

export type DelayTone = 'none' | 'early' | 'on-time' | 'late' | 'severe';

export function delayTone(delay: number | null | undefined): DelayTone {
	if (delay == null) return 'none';
	if (delay < 0) return 'early';
	if (delay >= 5) return 'severe';
	if (delay > 0) return 'late';
	return 'on-time';
}

/** A rounded measurement never reclassifies the publisher's raw-second status. */
export function delayMeasurement(delay: number | null | undefined): string | null {
	if (delay == null) return null;
	return `${delay < 0 ? '−' : delay > 0 ? '+' : ''}${Math.abs(delay)} min`;
}

const TONE_VAR: Record<DelayTone, string | undefined> = {
	early: 'var(--dataviz-status-early)',
	'on-time': 'var(--dataviz-status-on-time)',
	late: 'var(--dataviz-status-late)',
	severe: 'var(--dataviz-status-severe)',
	none: undefined,
};

export function delayColorVar(delay: number | null | undefined): string | undefined {
	return TONE_VAR[delayTone(delay)];
}

export function delaySeverity(delay: number | null | undefined): SeverityCode {
	if (delay == null || delay <= 0) return 'watch';
	return delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
}

export interface DelayLabelCopy {
	readonly early: (minutes: number) => string;
	readonly late: (minutes: number) => string;
	readonly onTime: string;
	readonly noDelay?: string;
}

export function delayLabel(delay: number | null | undefined, copy: DelayLabelCopy): string {
	if (delay == null) return copy.noDelay ?? copy.onTime;
	if (delay < 0) return copy.early(delay);
	if (delay > 0) return copy.late(delay);
	return copy.onTime;
}

export type ChipTone = Exclude<DelayTone, 'none'>;

export const TONE_GLYPH: Record<ChipTone, string> = {
	early: '▼',
	'on-time': '●',
	late: '▲',
	severe: '▲',
};

export function toneColorVar(tone: ChipTone): string | undefined {
	return TONE_VAR[tone];
}

export function rowGlyph(tone: DelayTone): string {
	return tone === 'none' ? '' : TONE_GLYPH[tone];
}

export function rowColorVar(tone: DelayTone): string | undefined {
	return TONE_VAR[tone];
}
