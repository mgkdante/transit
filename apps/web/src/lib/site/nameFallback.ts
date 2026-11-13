import type { Locale } from '#lib/i18n/copy.ts';

const NAME_FALLBACK_COPY: Record<Locale, { stop: string; route: string }> = {
	en: { stop: 'Stop {id} (name unavailable)', route: 'Line {id}' },
	fr: { stop: 'Arrêt {id} (nom indisponible)', route: 'Ligne {id}' },
};

export function stopNameFallback(id: string, locale: Locale): string {
	return (NAME_FALLBACK_COPY[locale] ?? NAME_FALLBACK_COPY.en).stop.replace('{id}', () =>
		String(id),
	);
}

export function routeNameFallback(id: string, locale: Locale): string {
	return (NAME_FALLBACK_COPY[locale] ?? NAME_FALLBACK_COPY.en).route.replace('{id}', () =>
		String(id),
	);
}
