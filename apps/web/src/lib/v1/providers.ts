import { delocalizePath, localizeHref, pathLocale } from '#lib/i18n/index.ts';
import { isInsideBounds } from '#lib/geocode/types.ts';
import type { ApproximateLocation } from './requestLocation';
import { v1BaseUrl } from './config';
import { PublicProviderCatalogSchema, type PublicProviderCatalog } from './schemas/providers';
export { PublicProviderSchema, PublicProviderCatalogSchema } from './schemas/providers';
export type { PublicProvider, PublicProviderCatalog } from './schemas/providers';

// Mirrors lines_without_live_data in apps/db/config/providers/{stm,octranspo}.yaml
// (stored in core.providers by seed-core, migration 0096).
// providers.json does not publish route-type declarations; provenance gaps can override
// the fallback on surfaces that already load provenance.
const LINES_WITHOUT_LIVE_DATA: Record<string, { routeTypes: readonly number[]; gap: string }> = {
	stm: { routeTypes: [1], gap: 'metro_realtime' },
	octranspo: { routeTypes: [0], gap: 'otrain_realtime' },
};

export function routeHasNoLiveData(
	providerId: string | undefined,
	routeType: number | null | undefined,
	gaps?: readonly string[] | null,
): boolean {
	const declaration =
		providerId && Object.hasOwn(LINES_WITHOUT_LIVE_DATA, providerId)
			? LINES_WITHOUT_LIVE_DATA[providerId]
			: undefined;
	return (
		!!declaration &&
		routeType != null &&
		declaration.routeTypes.includes(routeType) &&
		(gaps == null || gaps.includes(declaration.gap))
	);
}

export function providerHasAlerts(
	provider: import('./schemas/providers').PublicProvider | null | undefined,
): boolean {
	return !(provider?.inputs.i3_alerts === false && provider.inputs.service_alerts === false);
}

export function providerHref(url: URL, provider: string, lang = pathLocale(url.pathname)): string {
	let path = delocalizePath(url.pathname);
	if (path.startsWith('/lines/')) path = '/lines';
	if (/^\/(stop|trip)\//.test(path)) path = '/map';
	const next = new URL(localizeHref(path, lang), url);
	if (path !== '/map' && path !== '/receipt') {
		for (const key of ['date', 'mode']) {
			const value = url.searchParams.get(key);
			if (value !== null) next.searchParams.set(key, value);
		}
	}
	next.searchParams.set('provider', provider);
	return next.pathname + next.search;
}

export function resolveProvider(
	url: URL,
	catalog: PublicProviderCatalog,
	location?: ApproximateLocation | null,
) {
	const values = url.searchParams.getAll('provider');
	const matches =
		values.length === 0 && location
			? catalog.providers.filter(
					({ fit_bounds }) => fit_bounds && isInsideBounds(location.lat, location.lon, fit_bounds),
				)
			: [];
	const requested =
		values.length === 1
			? values[0]
			: matches.length === 1
				? matches[0].id
				: catalog.default_provider;
	const provider =
		catalog.providers.find(({ id }) => id === requested) ??
		catalog.providers.find(({ id }) => id === catalog.default_provider)!;
	const normalized =
		values.length > 1 ||
		(values.length === 1 && values[0] !== provider.id) ||
		(values.length === 0 && provider.id !== catalog.default_provider)
			? new URL(providerHref(url, provider.id), url)
			: url;
	return { provider, url: normalized };
}

export async function loadProviderCatalog(fetcher: typeof fetch): Promise<PublicProviderCatalog> {
	const response = await fetcher(`${v1BaseUrl()}/providers.json`);
	if (!response.ok) throw new Error(`Provider catalog unavailable (${response.status})`);
	return PublicProviderCatalogSchema.parse(await response.json());
}
