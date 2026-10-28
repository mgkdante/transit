import { intl } from '$lib/i18n';
export type TimeLang = 'en' | 'fr';

export const DISPLAY_TIME_ZONE = 'America/Toronto' as const;

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
	const parts = intl
		.dateTime('en', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			timeZone: DISPLAY_TIME_ZONE,
		})
		.formatToParts(date);
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
	const resolved: Intl.DateTimeFormatOptions = {
		...(opts ?? base),
		timeZone: opts?.timeZone ?? DISPLAY_TIME_ZONE,
	};
	return intl.dateTime(lang, resolved).format(date);
}

export function formatDateKey(key: string, lang: TimeLang, includeYear = false): string {
	const date = parseIso(key);
	if (!date) return '·';
	return intl
		.dateTime(lang, {
			month: 'short',
			day: 'numeric',
			...(includeYear ? { year: 'numeric' as const } : {}),
			timeZone: 'UTC',
		})
		.format(date);
}

export function formatClock(
	date: Date,
	lang: TimeLang,
	timeZone: string = DISPLAY_TIME_ZONE,
): string {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '·';
	const parts = intl
		.dateTime(lang, {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone,
		})
		.formatToParts(date);
	const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
	const hh = hour === '24' ? '00' : hour.padStart(2, '0');
	return `${hh}:${minute.padStart(2, '0')}`;
}

export function minutesSinceMidnight(date: Date = new Date()): number {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return Number.NaN;
	const parts = intl
		.dateTime('en', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: DISPLAY_TIME_ZONE,
		})
		.formatToParts(date);
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

export function formatRelativeSeconds(seconds: number, lang: TimeLang): string {
	return Number.isNaN(seconds) ? '·' : intl.relativeTime(lang, -seconds);
}

export function formatRelative(iso: string, lang: TimeLang, now: Date = new Date()): string {
	return formatRelativeSeconds(ageSeconds(iso, now), lang);
}
