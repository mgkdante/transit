import { delocalizePath, localizeHref, pathLocale } from '$lib/i18n';
import { v1BaseUrl } from './config';
import { PublicProviderCatalogSchema, type PublicProviderCatalog } from './schemas/providers';
export { PublicProviderSchema, PublicProviderCatalogSchema } from './schemas/providers';
export type { PublicProvider, PublicProviderCatalog } from './schemas/providers';

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

export function resolveProvider(url: URL, catalog: PublicProviderCatalog) {
	const values = url.searchParams.getAll('provider');
	const requested = values.length === 1 ? values[0] : catalog.default_provider;
	const provider =
		catalog.providers.find(({ id }) => id === requested) ??
		catalog.providers.find(({ id }) => id === catalog.default_provider)!;
	const normalized =
		values.length > 1 || (values.length === 1 && values[0] !== provider.id)
			? new URL(providerHref(url, provider.id), url)
			: url;
	return { provider, url: normalized };
}

export async function loadProviderCatalog(fetcher: typeof fetch): Promise<PublicProviderCatalog> {
	const response = await fetcher(`${v1BaseUrl()}/providers.json`);
	if (!response.ok) throw new Error(`Provider catalog unavailable (${response.status})`);
	return PublicProviderCatalogSchema.parse(await response.json());
}
