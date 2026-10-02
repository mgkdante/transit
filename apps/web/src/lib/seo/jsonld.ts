import {
	SCHEMA_ORG_CONTEXT,
	buildBreadcrumbListJsonLd,
	buildDatasetJsonLd,
	buildOrganizationJsonLd,
	buildWebSiteJsonLd,
	type JsonLdNode as SeoKitJsonLdNode,
} from '@yesid/seo-kit/jsonld';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';

export type JsonLdNode = SeoKitJsonLdNode & { '@context': typeof SCHEMA_ORG_CONTEXT };

function hasSchemaContext(node: SeoKitJsonLdNode): node is JsonLdNode {
	return node['@context'] === SCHEMA_ORG_CONTEXT;
}

function contextual(node: SeoKitJsonLdNode): JsonLdNode {
	if (!hasSchemaContext(node)) {
		throw new Error('JSON-LD builder omitted the required schema.org context');
	}
	return node;
}

export const DATASET_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

interface WebSiteJsonLdInput {
	siteOrigin: string;
	siteName: string;
	locale?: Locale;
}

export function websiteJsonLd({
	siteOrigin,
	siteName,
	locale = DEFAULT_LOCALE,
}: WebSiteJsonLdInput): JsonLdNode {
	return contextual(
		buildWebSiteJsonLd({
			context: true,
			name: siteName,
			url: siteOrigin,
			inLanguage: locale,
			searchUrlTemplate: `${siteOrigin}/search?q={query}`,
		}),
	);
}

export interface BreadcrumbItem {
	name: string;
	url: string;
}

export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]): JsonLdNode | null {
	const node = buildBreadcrumbListJsonLd({ context: true, items, empty: 'null' });
	return node === null ? null : contextual(node);
}

interface OrganizationJsonLdInput {
	siteOrigin: string;
	siteName: string;
}

export function organizationJsonLd({ siteOrigin, siteName }: OrganizationJsonLdInput): JsonLdNode {
	return contextual(
		buildOrganizationJsonLd({
			context: true,
			id: `${siteOrigin}#organization`,
			name: siteName,
			url: siteOrigin,
		}),
	);
}

interface DatasetJsonLdInput {
	siteOrigin: string;
	siteName: string;
	name: string;
	description: string;
	locale?: Locale;
}

export function datasetJsonLd({
	siteOrigin,
	siteName,
	name,
	description,
	locale = DEFAULT_LOCALE,
}: DatasetJsonLdInput): JsonLdNode {
	return contextual(
		buildDatasetJsonLd({
			context: true,
			name,
			description,
			url: siteOrigin,
			inLanguage: locale,
			license: DATASET_LICENSE_URL,
			isAccessibleForFree: true,
			creator: buildOrganizationJsonLd({
				id: `${siteOrigin}#organization`,
				name: siteName,
				url: siteOrigin,
			}),
		}),
	);
}
