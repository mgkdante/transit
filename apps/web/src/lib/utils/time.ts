/**
 * Time formatting for the transit web app.
 *
 * Every timestamp the pipeline emits is UTC (ISO 8601). Riders read times in
 * Montreal/Toronto wall-clock, so EVERYTHING renders in the America/Toronto
 * zone via Intl — never the browser's local zone, never raw UTC. Keep all
 * timestamp rendering behind these helpers so the zone is enforced in one place.
 *
 * `lang` is the BCP-47-ish locale tag we support ('en' | 'fr'), matching the
 * `Locale` contract in `$lib/i18n`. We deliberately do NOT import that module
 * here to keep this util dependency-free (it is consumed by low-level
 * components and the i18n layer alike).
 */

/** Supported UI languages. Mirrors `Locale` from `$lib/i18n`. */
export type TimeLang = 'en' | 'fr';

/** IANA zone all rider-facing times render in. */
export const DISPLAY_TIME_ZONE = 'America/Toronto' as const;

/** Map our short lang code to a BCP-47 tag for Intl. */
function localeTag(lang: TimeLang): string {
	return lang === 'fr' ? 'fr-CA' : 'en-CA';
}

/** Parse an ISO string into a Date, returning null for empty/invalid input. */
function parseIso(iso: string): Date | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a UTC ISO timestamp into a localized America/Toronto string.
 *
 * Defaults to a medium date + short time (e.g. "Jun 15, 2026, 3:04 p.m.").
 * Pass `opts` to override; `timeZone` is always forced to America/Toronto and
 * cannot be overridden (the whole point of this helper).
 *
 * Returns an em dash for empty/invalid input so callers can render the result
 * directly without null-guards.
 */
export function formatUtc(iso: string, lang: TimeLang, opts?: Intl.DateTimeFormatOptions): string {
	const date = parseIso(iso);
	if (!date) return '—';
	const base: Intl.DateTimeFormatOptions = {
		dateStyle: 'medium',
		timeStyle: 'short',
	};
	// A caller-supplied dateStyle/timeStyle is incompatible with explicit field
	// options; when opts is provided we hand it through verbatim (minus timeZone)
	// rather than merging onto the dateStyle/timeStyle base.
	const resolved: Intl.DateTimeFormatOptions = opts
		? { ...opts, timeZone: DISPLAY_TIME_ZONE }
		: { ...base, timeZone: DISPLAY_TIME_ZONE };
	return new Intl.DateTimeFormat(localeTag(lang), resolved).format(date);
}

/**
 * Format a Date as a 24-hour clock "HH:MM" in America/Toronto.
 *
 * Always zero-padded, 24-hour (hour12 disabled) so it reads as a stable signage
 * clock regardless of locale defaults. Returns "—" for an invalid Date.
 */
export function formatClock(date: Date, lang: TimeLang): string {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
	// Use formatToParts so we can guarantee "HH:MM" without locale separators.
	const parts = new Intl.DateTimeFormat(localeTag(lang), {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: DISPLAY_TIME_ZONE,
	}).formatToParts(date);
	const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
	// Some locales emit "24" for midnight under hour12:false; normalize to "00".
	const hh = hour === '24' ? '00' : hour.padStart(2, '0');
	return `${hh}:${minute.padStart(2, '0')}`;
}

/**
 * Seconds elapsed between `iso` and `now` (defaults to current time).
 *
 * Positive when `iso` is in the past, negative when in the future. Returns NaN
 * for invalid input so callers can decide how to render "no data".
 */
export function ageSeconds(iso: string, now: Date | number = Date.now()): number {
	const date = parseIso(iso);
	if (!date) return Number.NaN;
	const nowMs = typeof now === 'number' ? now : now.getTime();
	return Math.round((nowMs - date.getTime()) / 1000);
}

/** Relative-time unit thresholds (in seconds), largest first. */
const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
	{ unit: 'year', seconds: 60 * 60 * 24 * 365 },
	{ unit: 'month', seconds: 60 * 60 * 24 * 30 },
	{ unit: 'week', seconds: 60 * 60 * 24 * 7 },
	{ unit: 'day', seconds: 60 * 60 * 24 },
	{ unit: 'hour', seconds: 60 * 60 },
	{ unit: 'minute', seconds: 60 },
	{ unit: 'second', seconds: 1 },
];

/**
 * Localized relative time from a PRE-COMPUTED age in seconds, e.g. "2 minutes
 * ago" / "il y a 2 minutes". Positive = past, negative = future.
 *
 * Prefer this over `formatRelative` when the caller already tracks a ticking age
 * (e.g. the live store's `ageSeconds`, advanced every second): a `$derived` over
 * the age re-runs each tick, whereas `formatRelative(iso)` reads an internal
 * `now` that is NOT reactive — so the relative text would freeze between the
 * inputs that DO change. Built on Intl.RelativeTimeFormat for locale-correct
 * phrasing/plurals/direction. Within 5 seconds reads "now"/"maintenant".
 * Returns "—" for NaN.
 */
export function formatRelativeSeconds(seconds: number, lang: TimeLang): string {
	if (Number.isNaN(seconds)) return '—';
	if (Math.abs(seconds) < 5) return lang === 'fr' ? 'maintenant' : 'now';

	const rtf = new Intl.RelativeTimeFormat(localeTag(lang), { numeric: 'auto' });
	for (const { unit, seconds: unitSeconds } of RELATIVE_UNITS) {
		if (Math.abs(seconds) >= unitSeconds || unit === 'second') {
			// Positive `seconds` = past → negative value for RelativeTimeFormat.
			const value = -Math.round(seconds / unitSeconds);
			return rtf.format(value, unit);
		}
	}
	// Unreachable (the "second" branch always matches), but keeps TS exhaustive.
	return rtf.format(-seconds, 'second');
}

/**
 * Localized relative time vs now, e.g. "2 minutes ago" / "il y a 2 minutes".
 *
 * Built on Intl.RelativeTimeFormat so the phrasing, plurals, and "ago"/future
 * direction are locale-correct. Within 5 seconds it reads as "now"/"maintenant".
 * Returns "—" for invalid input.
 *
 * NOTE: `now` defaults to a one-shot snapshot — the result does NOT tick on its
 * own. For a value that updates every second, track the age reactively and call
 * `formatRelativeSeconds` instead.
 */
export function formatRelative(iso: string, lang: TimeLang, now: Date = new Date()): string {
	return formatRelativeSeconds(ageSeconds(iso, now), lang);
}
