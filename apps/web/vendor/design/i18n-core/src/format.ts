export interface LocaleIntl<Locale extends string> {
	number(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat;
	dateTime(locale: Locale, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
	collator(locale: Locale, options?: Intl.CollatorOptions): Intl.Collator;
	plural(locale: Locale, options?: Intl.PluralRulesOptions): Intl.PluralRules;
	/**
	 * Reads `seconds` from now (negative is past) in its largest whole unit, rounding half away from
	 * zero; under 5 seconds is "now". A non-finite offset throws a RangeError, as Intl does.
	 */
	relativeTime(locale: Locale, seconds: number): string;
}

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
	['year', 31_536_000],
	['month', 2_592_000],
	['week', 604_800],
	['day', 86_400],
	['hour', 3_600],
	['minute', 60],
	['second', 1],
];

/**
 * Binds each app locale to the BCP 47 tag Intl formats it with. Formatters are cached per locale
 * and options (plain option objects, compared by their JSON), so call sites can ask for one on
 * every render.
 */
export function createIntl<Locale extends string>(tags: Readonly<Record<Locale, string>>): LocaleIntl<Locale> {
	const cache = new Map<string, unknown>();
	function cached<T>(kind: string, locale: Locale, options: object | undefined, make: (tag: string) => T): T {
		const key = `${kind}|${locale}|${JSON.stringify(options ?? {})}`;
		if (!cache.has(key)) cache.set(key, make(tags[locale]));
		return cache.get(key) as T;
	}

	return {
		number: (locale, options) => cached('number', locale, options, (tag) => new Intl.NumberFormat(tag, options)),
		dateTime: (locale, options) => cached('dateTime', locale, options, (tag) => new Intl.DateTimeFormat(tag, options)),
		collator: (locale, options) => cached('collator', locale, options, (tag) => new Intl.Collator(tag, options)),
		plural: (locale, options) => cached('plural', locale, options, (tag) => new Intl.PluralRules(tag, options)),
		relativeTime(locale, seconds) {
			const format = cached('relative', locale, undefined, (tag) => new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }));
			const distance = Math.abs(seconds);
			if (distance < 5) return format.format(0, 'second');
			const [unit, size] = UNITS.find(([, size]) => distance >= size) ?? ['second', 1];
			return format.format(Math.sign(seconds) * Math.round(distance / size), unit);
		},
	};
}
