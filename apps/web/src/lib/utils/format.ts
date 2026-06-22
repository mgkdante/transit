/**
 * Numeric value formatting for the transit web app — the ONE place the
 * null -> no-data honesty branch lives.
 *
 * The honesty doctrine: a null / undefined / NaN value is an ABSENCE, never a
 * fabricated 0, never a bare "·". Every formatter here funnels missing input
 * through a single `noData` branch. Callers choose what an absence renders as:
 *
 *   - `noData: null`   -> returns `null`, so the caller's own empty state takes
 *                         over (e.g. <MetricDisplay emptyLabel>, "?? copy.noData").
 *   - `noData: 'text'` -> returns the localized no-data string inline.
 *
 * Rounding / suffix / locale are all parameterized so each call site reproduces
 * its EXACT prior output. Nothing here adds or removes localization — pass the
 * `locale` only where the original code localized the number, and pass the same
 * suffix the original concatenated (`'%'`, `' %'`, `' min'`, a `t.units.*`
 * token, ...).
 *
 * Pure + dependency-free: consumed by low-level components, features, and the
 * root route alike.
 */

/** Supported UI languages. Mirrors `Locale` from `$lib/i18n` / `TimeLang`. */
export type FormatLang = 'en' | 'fr';

/** Map our short lang code to a BCP-47 tag for `Intl` / `toLocaleString`. */
function localeTag(lang: FormatLang): string {
	return lang === 'fr' ? 'fr-CA' : 'en-CA';
}

/** A real, finite number is the only thing we will format. */
function isPresent(v: number | null | undefined): v is number {
	return v != null && Number.isFinite(v);
}

/** How the integer/decimal part of the number is rendered. */
type Rounding =
	| 'raw' // String(v) — the value as-is (default)
	| 'round' // Math.round(v) — nearest integer
	| 'fixed1'; // v.toFixed(1) — exactly one decimal

/** Render the numeric core of a value per the chosen rounding + optional locale. */
function core(v: number, rounding: Rounding, locale: FormatLang | undefined): string {
	if (locale) {
		const tag = localeTag(locale);
		switch (rounding) {
			case 'round':
				return Math.round(v).toLocaleString(tag);
			case 'fixed1':
				return v.toLocaleString(tag, {
					minimumFractionDigits: 1,
					maximumFractionDigits: 1,
				});
			default:
				return v.toLocaleString(tag);
		}
	}
	switch (rounding) {
		case 'round':
			return String(Math.round(v));
		case 'fixed1':
			return v.toFixed(1);
		default:
			return String(v);
	}
}

/** Shared options across the formatters. `NoData` is the absence sentinel type. */
interface BaseOpts<NoData extends string | null> {
	/** How to round the numeric core. Default `'raw'`. */
	rounding?: Rounding;
	/** Locale tag for thousands grouping / decimal separators. Omit for bare `String()`. */
	locale?: FormatLang;
	/** What an absent value renders as: `null` (caller's empty state) or a string. */
	noData?: NoData;
}

/**
 * Format a nullable percent. Appends `suffix` (default `'%'`) to the numeric
 * core. Absence -> `opts.noData` (default `null`).
 *
 * @example fmtPct(82)                              // "82%"
 * @example fmtPct(4.2, { rounding: 'fixed1' })     // "4.2%"
 * @example fmtPct(81.6, { rounding: 'round' })     // "82%"
 * @example fmtPct(82, { suffix: ' %', locale: 'fr' }) // "82 %"
 * @example fmtPct(null)                            // null
 * @example fmtPct(null, { noData: 'no data' })     // "no data"
 */
export function fmtPct<NoData extends string | null = null>(
	v: number | null | undefined,
	opts: BaseOpts<NoData> & { suffix?: string } = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	return `${core(v, opts.rounding ?? 'raw', opts.locale)}${opts.suffix ?? '%'}`;
}

/**
 * Format a nullable count. No suffix; rounding `'raw'` by default. Pass
 * `locale` to get localized thousands separators. Absence -> `opts.noData`
 * (default `null`).
 *
 * @example fmtCount(5)                              // "5"
 * @example fmtCount(1234, { locale: 'en' })         // "1,234"
 * @example fmtCount(null, { noData: 'no data' })    // "no data"
 */
export function fmtCount<NoData extends string | null = null>(
	v: number | null | undefined,
	opts: BaseOpts<NoData> = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	return core(v, opts.rounding ?? 'raw', opts.locale);
}

/**
 * Format a nullable minute value. Appends `suffix` (default `' min'`).
 * `rounding: 'auto'` reproduces the "integer stays integer, else one decimal"
 * pattern; otherwise behaves like `fmtCount`/`fmtPct`. Absence -> `opts.noData`
 * (default `null`).
 *
 * @example fmtDelayMin(3)                                  // "3 min"
 * @example fmtDelayMin(3.2, { rounding: 'fixed1' })        // "3.2 min"
 * @example fmtDelayMin(3.4, { rounding: 'auto' })          // "3.4 min"
 * @example fmtDelayMin(3, { rounding: 'auto' })            // "3 min"
 * @example fmtDelayMin(null, { noData: 'no data' })        // "no data"
 */
export function fmtDelayMin<NoData extends string | null = null>(
	v: number | null | undefined,
	opts: Omit<BaseOpts<NoData>, 'rounding'> & {
		rounding?: Rounding | 'auto';
		suffix?: string;
	} = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	const suffix = opts.suffix ?? ' min';
	if (opts.rounding === 'auto') {
		// "integer stays integer, else <=1 decimal". With a `locale`, defer to Intl
		// (grouping + locale decimal mark, max 1 fraction digit); without, the plain
		// String/toFixed pair. Both keep an integer as an integer.
		const n = opts.locale
			? v.toLocaleString(localeTag(opts.locale), { maximumFractionDigits: 1 })
			: Number.isInteger(v)
				? String(v)
				: v.toFixed(1);
		return `${n}${suffix}`;
	}
	return `${core(v, opts.rounding ?? 'raw', opts.locale)}${suffix}`;
}
