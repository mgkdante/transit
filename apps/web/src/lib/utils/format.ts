import { roundHalfAwayFromZero } from './rounding';

export type FormatLang = 'en' | 'fr';

function localeTag(lang: FormatLang): string {
	return lang === 'fr' ? 'fr-CA' : 'en-CA';
}

function isPresent(v: number | null | undefined): v is number {
	return v != null && Number.isFinite(v);
}

type Rounding = 'raw' | 'round' | 'fixed1' | 'auto';

const numberFormats = new Map<string, Intl.NumberFormat>();

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

interface BaseOpts<NoData extends string | null> {
	rounding?: Rounding;
	locale?: FormatLang;
	noData?: NoData;
}

export function fmtPct<NoData extends string | null = null>(
	v: number | null | undefined,
	opts: BaseOpts<NoData> & { suffix?: string } = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	return `${core(v, opts.rounding ?? 'raw', opts.locale)}${opts.suffix ?? '%'}`;
}

export function fmtNumber<NoData extends string | null = null>(
	v: number | null | undefined,
	opts: BaseOpts<NoData> = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	return core(v, opts.rounding ?? 'raw', opts.locale);
}

export { fmtNumber as fmtCount };

export function fmtDelayMin<NoData extends string | null = null>(
	v: number | null | undefined,
	opts: BaseOpts<NoData> & { suffix?: string } = {},
): string | NoData {
	if (!isPresent(v)) return (opts.noData ?? null) as NoData;
	const suffix = opts.suffix ?? ' min';

	return `${core(v, opts.rounding ?? 'raw', opts.locale)}${suffix}`;
}
