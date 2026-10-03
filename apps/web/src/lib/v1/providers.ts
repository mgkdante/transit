import { z } from 'zod';
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
	bbox: bounds,
	tz: z.string().min(1),
	default_lang: z.string(),
	attribution: z.string(),
	website_url: z.url().nullable().optional(),
	fit_bounds: bounds.nullable().optional(),
	max_bounds: bounds.nullable().optional(),
	geocode_context: z.string().nullable().optional(),
	basemap_url: z.string().min(1),
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

export async function loadProviderCatalog(fetcher: typeof fetch): Promise<PublicProviderCatalog> {
	const response = await fetcher(`${v1BaseUrl()}/providers.json`);
	if (!response.ok) throw new Error(`Provider catalog unavailable (${response.status})`);
	return PublicProviderCatalogSchema.parse(await response.json());
}
