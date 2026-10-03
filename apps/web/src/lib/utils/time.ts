export type TimeLang = 'en' | 'fr';

export const DISPLAY_TIME_ZONE = 'America/Toronto' as const;

function localeTag(lang: TimeLang): string {
	return lang === 'fr' ? 'fr-CA' : 'en-CA';
}

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

function formatterKey(locale: string, options: object): string {
	return `${locale}|${JSON.stringify(options)}`;
}

function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = formatterKey(locale, options);
	let fmt = dateTimeFormatCache.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(locale, options);
		dateTimeFormatCache.set(key, fmt);
	}
	return fmt;
}

function relativeTimeFormat(
	locale: string,
	options: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
	const key = formatterKey(locale, options);
	let fmt = relativeTimeFormatCache.get(key);
	if (!fmt) {
		fmt = new Intl.RelativeTimeFormat(locale, options);
		relativeTimeFormatCache.set(key, fmt);
	}
	return fmt;
}

function parseIso(iso: string): Date | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function elapsedUtcMinutes(
	first: string | null | undefined,
	last: string | null | undefined,
): number | null {
	const offset = /(?:z|[+-]\d{2}:\d{2})$/i;
	if (first == null || last == null || !offset.test(first) || !offset.test(last)) return null;
	const minutes = (Date.parse(last) - Date.parse(first)) / 60_000;
	return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function providerLocalDateKey(iso: string | null | undefined): string | null {
	if (iso == null) return null;
	const date = parseIso(iso);
	if (date == null) return null;
	const parts = dateTimeFormat(localeTag('en'), {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: DISPLAY_TIME_ZONE,
	}).formatToParts(date);
	const year = parts.find((part) => part.type === 'year')?.value;
	const month = parts.find((part) => part.type === 'month')?.value;
	const day = parts.find((part) => part.type === 'day')?.value;
	return year != null && month != null && day != null ? `${year}-${month}-${day}` : null;
}

export function formatUtc(iso: string, lang: TimeLang, opts?: Intl.DateTimeFormatOptions): string {
	const date = parseIso(iso);
	if (!date) return '·';
	const base: Intl.DateTimeFormatOptions = {
		dateStyle: 'medium',
		timeStyle: 'short',
	};
	const resolved: Intl.DateTimeFormatOptions = opts
		? { ...opts, timeZone: DISPLAY_TIME_ZONE }
		: { ...base, timeZone: DISPLAY_TIME_ZONE };
	return dateTimeFormat(localeTag(lang), resolved).format(date);
}

export function formatDateKey(key: string, lang: TimeLang, includeYear = false): string {
	const date = parseIso(key);
	if (!date) return '·';
	return dateTimeFormat(localeTag(lang), {
		month: 'short',
		day: 'numeric',
		...(includeYear ? { year: 'numeric' as const } : {}),
		timeZone: 'UTC',
	}).format(date);
}

export function formatClock(
	date: Date,
	lang: TimeLang,
	timeZone: string = DISPLAY_TIME_ZONE,
): string {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '·';
	const parts = dateTimeFormat(localeTag(lang), {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone,
	}).formatToParts(date);
	const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
	const hh = hour === '24' ? '00' : hour.padStart(2, '0');
	return `${hh}:${minute.padStart(2, '0')}`;
}

export function minutesSinceMidnight(date: Date = new Date()): number {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return Number.NaN;
	const parts = dateTimeFormat(localeTag('en'), {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: DISPLAY_TIME_ZONE,
	}).formatToParts(date);
	const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minuteRaw = parts.find((p) => p.type === 'minute')?.value ?? '00';
	const hour = hourRaw === '24' ? 0 : Number.parseInt(hourRaw, 10);
	const minute = Number.parseInt(minuteRaw, 10);
	if (Number.isNaN(hour) || Number.isNaN(minute)) return Number.NaN;
	return hour * 60 + minute;
}

export function ageSeconds(iso: string, now: Date | number = Date.now()): number {
	const date = parseIso(iso);
	if (!date) return Number.NaN;
	const nowMs = typeof now === 'number' ? now : now.getTime();
	return Math.round((nowMs - date.getTime()) / 1000);
}

const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
	{ unit: 'year', seconds: 60 * 60 * 24 * 365 },
	{ unit: 'month', seconds: 60 * 60 * 24 * 30 },
	{ unit: 'week', seconds: 60 * 60 * 24 * 7 },
	{ unit: 'day', seconds: 60 * 60 * 24 },
	{ unit: 'hour', seconds: 60 * 60 },
	{ unit: 'minute', seconds: 60 },
	{ unit: 'second', seconds: 1 },
];

export function formatRelativeSeconds(seconds: number, lang: TimeLang): string {
	if (Number.isNaN(seconds)) return '·';
	if (Math.abs(seconds) < 5) return lang === 'fr' ? 'maintenant' : 'now';

	const rtf = relativeTimeFormat(localeTag(lang), { numeric: 'auto' });
	for (const { unit, seconds: unitSeconds } of RELATIVE_UNITS) {
		if (Math.abs(seconds) >= unitSeconds || unit === 'second') {
			const value = -Math.round(seconds / unitSeconds);
			return rtf.format(value, unit);
		}
	}
	return rtf.format(-seconds, 'second');
}

export function formatRelative(iso: string, lang: TimeLang, now: Date = new Date()): string {
	return formatRelativeSeconds(ageSeconds(iso, now), lang);
}
