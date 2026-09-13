/** Finite values are formatted; missing values preserve the caller’s no-data sentinel. */

import { roundHalfAwayFromZero } from './rounding';

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
	| 'round' // nearest integer, decimal ties away from zero
	| 'fixed1' // exactly one decimal, ties away from zero
	| 'auto'; // integers stay integers, otherwise at most one decimal

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Render the numeric core of a value per the chosen rounding + optional locale. */
function core(v: number, rounding: Rounding, locale: FormatLang | undefined): string {
	const rounded = rounding === 'raw' ? v : roundHalfAwayFromZero(v, rounding === 'round' ? 0 : 1);
	if (locale) {
		const key = `${locale}:${rounding}`;
		let formatter = numberFormats.get(key);
		if (!formatter) {
			const options =
				rounding === 'fixed1'
					? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
					: rounding === 'auto'
						? { maximumFractionDigits: 1 }
						: undefined;
			formatter = new Intl.NumberFormat(localeTag(locale), options);
			numberFormats.set(key, formatter);
		}
		return formatter.format(rounded);
	}

	switch (rounding) {
		case 'round':
			return String(rounded);
		case 'auto':
			return Number.isInteger(v) ? String(v) : rounded.toFixed(1);
		case 'fixed1':
			return rounded.toFixed(1);
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
 * Format a nullable number. No suffix; rounding `'raw'` by default. Pass
 * `locale` to get localized thousands separators. Absence -> `opts.noData`
 * (default `null`).
 *
 * @example fmtCount(5)                              // "5"
 * @example fmtCount(1234, { locale: 'en' })         // "1,234"
 * @example fmtCount(null, { noData: 'no data' })    // "no data"
 */
export function fmtNumber<NoData extends string | null = null>(
	v: number | null | undefined,
	opts: BaseOpts<NoData> = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	return core(v, opts.rounding ?? 'raw', opts.locale);
}

export { fmtNumber as fmtCount };

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
	opts: BaseOpts<NoData> & { suffix?: string } = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	const suffix = opts.suffix ?? ' min';

	return `${core(v, opts.rounding ?? 'raw', opts.locale)}${suffix}`;
}
