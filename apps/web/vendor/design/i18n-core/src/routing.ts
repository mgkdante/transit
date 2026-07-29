export type PathExemptionPredicate = (pathname: string) => boolean;

export interface LocaleRoutingConfig<Locale extends string> {
	readonly defaultLocale: Locale;
	readonly prefixLocales: readonly Locale[];
	readonly isPathExempt: PathExemptionPredicate;
	readonly localeSegment: string;
	readonly preserveSearchAndHash: boolean;
}

export interface UrlParts {
	readonly pathname: string;
	readonly search: string;
	readonly hash: string;
}

export interface LocaleRouting<Locale extends string> {
	pathLocale(pathname: string): Locale;
	delocalizePath(pathname: string): string;
	localizeHref(href: string, locale: Locale): string;
	localizeUrl(url: UrlParts, locale: Locale): string;
	isLocaleSwitch(fromPathname: string, toPathname: string): boolean;
	stripLocaleSegment(routeId: string): string;
	isPrefixLocale(value: string): value is Locale;
}

export function createLocaleRouting<Locale extends string>(
	config: LocaleRoutingConfig<Locale>,
): LocaleRouting<Locale> {
	const {
		defaultLocale,
		prefixLocales,
		isPathExempt,
		localeSegment,
		preserveSearchAndHash,
	} = config;
	const prefixSet: ReadonlySet<string> = new Set(prefixLocales);

	if (prefixSet.has(defaultLocale)) {
		throw new Error('defaultLocale must not appear in prefixLocales');
	}

	function isPrefixLocale(value: string): value is Locale {
		return prefixSet.has(value);
	}

	function prefixOf(pathname: string): Locale | null {
		const segment = pathname.split('/')[1] ?? '';
		return isPrefixLocale(segment) ? segment : null;
	}

	function pathLocale(pathname: string): Locale {
		return prefixOf(pathname) ?? defaultLocale;
	}

	function delocalizePath(pathname: string): string {
		if (pathname === '') return '/';
		const prefix = prefixOf(pathname);
		if (!prefix) return pathname;
		const rest = pathname.slice(prefix.length + 1);
		return rest === '' || rest === '/' ? '/' : rest;
	}

	function localizeHref(href: string, locale: Locale): string {
		if (!href.startsWith('/') || href.startsWith('//')) return href;
		if (isPathExempt(href)) return href;
		const base = delocalizePath(href);
		if (locale === defaultLocale || !isPrefixLocale(locale)) return base;
		return base === '/' ? `/${locale}` : `/${locale}${base}`;
	}

	function localizeUrl(url: UrlParts, locale: Locale): string {
		const href = localizeHref(url.pathname, locale);
		if (!preserveSearchAndHash) return href;
		return href + url.search + url.hash;
	}

	function isLocaleSwitch(fromPathname: string, toPathname: string): boolean {
		return (
			delocalizePath(fromPathname) === delocalizePath(toPathname) &&
			pathLocale(fromPathname) !== pathLocale(toPathname)
		);
	}

	function stripLocaleSegment(routeId: string): string {
		if (routeId === localeSegment) return '/';
		if (routeId.startsWith(`${localeSegment}/`)) return routeId.slice(localeSegment.length);
		return routeId;
	}

	return {
		pathLocale,
		delocalizePath,
		localizeHref,
		localizeUrl,
		isLocaleSwitch,
		stripLocaleSegment,
		isPrefixLocale,
	};
}
