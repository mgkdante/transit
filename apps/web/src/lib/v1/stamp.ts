import type { Locale } from '#lib/i18n/copy.ts';
import { formatDateKey } from '#lib/utils/time.ts';
import type { HistoricAvailabilityIndex, Manifest } from './schemas/index';
import { recordClosedThrough } from './closedWindow';
import { stampCopy } from './stamp.copy';

export interface LiveStamp {
	readonly form: 'live';
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
}): RecordStamp {
	return {
		form: 'record',
		scope: input.day ? 'day' : 'window',
		dataThrough: input.day ?? recordClosedThrough(input.historyIndex),
		publishedOn:
			(input.fileGeneratedUtc ?? input.manifest?.files.historic?.generated_utc)?.slice(0, 10) ??
			null,
		nextUpdateUtc: null,
		warning: false,
	};
}
export function stampText(
	stamp: LiveStamp | RecordStamp,
	locale: Locale,
	timeZone: string | undefined,
): string {
	if (stamp.form !== 'record' || (!stamp.dataThrough && !stamp.publishedOn)) return '';
	const year = timeZone
		? new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(new Date())
		: null;
	const date = (key: string | null) =>
		key ? formatDateKey(key, locale, key.slice(0, 4) !== year) : null;
	return stampCopy[locale].record(date(stamp.dataThrough), date(stamp.publishedOn), stamp.scope);
}
