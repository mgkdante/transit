import type { Locale } from '#lib/i18n/copy.ts';
import { formatRelativeSeconds, formatDateKey } from '#lib/utils/time.ts';
import type { DataHealth, HistoricAvailabilityIndex, Manifest } from './schemas/index';
import { recordClosedThrough } from './closedWindow';
import { stampCopy, type LiveState } from './stamp.copy';
export type { LiveState } from './stamp.copy';

export interface LiveStamp {
	readonly form: 'live';
	readonly subject: 'data' | 'alerts';
	readonly state: LiveState;
	readonly ageSeconds: number | null;
	readonly generatedUtc: string | null;
}
export function liveStamp(input: {
	readonly subject?: 'data' | 'alerts';
	readonly ageSeconds: number | null;
	readonly generatedUtc?: string | null;
	readonly isStale?: boolean;
	readonly notResponding?: boolean;
}): LiveStamp {
	return {
		form: 'live',
		subject: input.subject ?? 'data',
		state: input.notResponding
			? 'not-responding'
			: input.ageSeconds == null
				? 'unknown'
				: input.isStale
					? 'behind'
					: 'current',
		ageSeconds: input.ageSeconds,
		generatedUtc: input.generatedUtc ?? null,
	};
}
export interface RecordStamp {
	readonly form: 'record';
	readonly scope: 'window' | 'day';
	readonly dataThrough: string | null;
	readonly publishedOn: string | null;
	readonly nextUpdateUtc: string | null;
	readonly warning: boolean;
}
export function recordStamp(input: {
	readonly manifest: Manifest | null;
	readonly historyIndex: HistoricAvailabilityIndex | null;
	readonly fileGeneratedUtc?: string | null;
	readonly day?: string;
	readonly dataHealth?: DataHealth | null;
}): RecordStamp {
	return {
		form: 'record',
		scope: input.day ? 'day' : 'window',
		dataThrough: input.day ?? recordClosedThrough(input.historyIndex),
		publishedOn:
			(input.fileGeneratedUtc ?? input.manifest?.files.historic?.generated_utc)?.slice(0, 10) ??
			null,
		nextUpdateUtc: null,
		warning: ['warn', 'fail'].includes(recordGate(input.dataHealth)?.verdict ?? ''),
	};
}
/** The quality check of the record's last publication: data health's rollup lane. */
export function recordGate(dataHealth: DataHealth | null | undefined) {
	return dataHealth?.lanes?.find((lane) => lane.lane === 'rollup')?.gate ?? null;
}
export function stampDate(key: string, locale: Locale, timeZone: string | undefined): string {
	const year = timeZone
		? new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(new Date())
		: null;
	return formatDateKey(key, locale, key.slice(0, 4) !== year);
}
export function stampText(
	stamp: LiveStamp | RecordStamp,
	locale: Locale,
	timeZone: string | undefined,
): string {
	if (stamp.form === 'live')
		return stampCopy[locale].live(
			stamp.subject,
			stamp.state,
			stamp.ageSeconds == null ? null : formatRelativeSeconds(stamp.ageSeconds, locale),
		);
	if (!stamp.dataThrough && !stamp.publishedOn) return '';
	const date = (key: string | null) => (key ? stampDate(key, locale, timeZone) : null);
	return stampCopy[locale].record(date(stamp.dataThrough), date(stamp.publishedOn), stamp.scope);
}
