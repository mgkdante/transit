import { z } from 'zod';
import { delocalizePath, localizeHref, pathLocale } from '$lib/i18n';
import { v1BaseUrl } from './config';
import { payloadEnvelopeFields } from './schemas/types';

const providerId = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const label = z.object({ city: z.string().min(1), operator: z.string().min(1) });
const bounds = z
	.tuple([z.number(), z.number(), z.number(), z.number()])
	.refine(
		([west, south, east, north]) =>
			-180 <= west && west < east && east <= 180 && -90 <= south && south < north && north <= 90,
	);

export const PublicProviderSchema = z.object({
	id: providerId,
	labels: z.object({ en: label, fr: label }),
	fit_bounds: bounds.nullable().optional(),
	max_bounds: bounds.nullable().optional(),
	geocode_context: z.string().nullable().optional(),
	posters_url: z.string().nullable().optional(),
	alert_links: z.object({ en: z.url().optional(), fr: z.url().optional() }),
	inputs: z.record(z.string(), z.boolean()),
});
export type PublicProvider = z.infer<typeof PublicProviderSchema>;

export const PublicProviderCatalogSchema = z
	.object({
		...payloadEnvelopeFields(),
		schema_version: z.literal(1),
		generated_utc: z.iso.datetime(),
		default_provider: providerId,
		providers: z.array(PublicProviderSchema).min(1),
	})
	.refine(({ default_provider, providers }) => {
		const ids = new Set(providers.map(({ id }) => id));
		return ids.size === providers.length && ids.has(default_provider);
	}, 'Catalog providers must be unique and include the default');
export type PublicProviderCatalog = z.infer<typeof PublicProviderCatalogSchema>;

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
