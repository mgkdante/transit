export const SCHEMA_ORG_CONTEXT = 'https://schema.org' as const;

export interface JsonLdReference {
	'@id': string;
}

export interface JsonLdNode {
	'@context'?: typeof SCHEMA_ORG_CONTEXT;
	'@type': string;
	'@id'?: string;
	[key: string]: unknown;
}

interface ContextOption {
	context?: boolean;
}

function context(context: boolean | undefined) {
	return context ? { '@context': SCHEMA_ORG_CONTEXT } : {};
}

export interface WebSiteJsonLdInput extends ContextOption {
	id?: string;
	name: string;
	url: string;
	description?: string;
	publisher?: JsonLdReference;
	inLanguage?: string;
	searchUrlTemplate?: string;
	searchQueryInput?: string;
}

export function buildWebSiteJsonLd(input: WebSiteJsonLdInput): JsonLdNode {
	return {
		...context(input.context),
		'@type': 'WebSite',
		...(input.id === undefined ? {} : { '@id': input.id }),
		name: input.name,
		url: input.url,
		...(input.description === undefined ? {} : { description: input.description }),
		...(input.publisher === undefined ? {} : { publisher: input.publisher }),
		...(input.inLanguage === undefined ? {} : { inLanguage: input.inLanguage }),
		...(input.searchUrlTemplate === undefined
			? {}
			: {
					potentialAction: {
						'@type': 'SearchAction',
						target: {
							'@type': 'EntryPoint',
							urlTemplate: input.searchUrlTemplate,
						},
						'query-input': input.searchQueryInput ?? 'required name=query',
					},
			}),
	};
}

export interface BreadcrumbJsonLdItem {
	name: string;
	url: string;
}

interface BreadcrumbListJsonLdBase extends ContextOption {
	id?: string;
	items: readonly BreadcrumbJsonLdItem[];
}

export function buildBreadcrumbListJsonLd(
	input: BreadcrumbListJsonLdBase & { empty: 'null' },
): JsonLdNode | null;
export function buildBreadcrumbListJsonLd(
	input: BreadcrumbListJsonLdBase & { empty?: 'node' },
): JsonLdNode;
export function buildBreadcrumbListJsonLd(
	input: BreadcrumbListJsonLdBase & { empty?: 'node' | 'null' },
): JsonLdNode | null {
	if (input.items.length === 0 && input.empty === 'null') return null;
	return {
		...context(input.context),
		'@type': 'BreadcrumbList',
		...(input.id === undefined ? {} : { '@id': input.id }),
		itemListElement: input.items.map((item, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: item.name,
			item: item.url,
		})),
	};
}

export interface OrganizationJsonLdInput extends ContextOption {
	id?: string;
	name: string;
	url: string;
}

export function buildOrganizationJsonLd(input: OrganizationJsonLdInput): JsonLdNode {
	return {
		...context(input.context),
		'@type': 'Organization',
		...(input.id === undefined ? {} : { '@id': input.id }),
		name: input.name,
		url: input.url,
	};
}

export interface DatasetJsonLdInput extends ContextOption {
	id?: string;
	name: string;
	description: string;
	url: string;
	inLanguage?: string;
	license?: string;
	isAccessibleForFree?: boolean;
	creator?: JsonLdNode | JsonLdReference;
}

export function buildDatasetJsonLd(input: DatasetJsonLdInput): JsonLdNode {
	return {
		...context(input.context),
		'@type': 'Dataset',
		...(input.id === undefined ? {} : { '@id': input.id }),
		name: input.name,
		description: input.description,
		url: input.url,
		...(input.inLanguage === undefined ? {} : { inLanguage: input.inLanguage }),
		...(input.license === undefined ? {} : { license: input.license }),
		...(input.isAccessibleForFree === undefined
			? {}
			: { isAccessibleForFree: input.isAccessibleForFree }),
		...(input.creator === undefined ? {} : { creator: input.creator }),
	};
}

export interface ProfilePageJsonLdInput extends ContextOption {
	id: string;
	mainEntity: JsonLdReference;
	dateCreated?: string;
	dateModified?: string;
}

export function buildProfilePageJsonLd(input: ProfilePageJsonLdInput): JsonLdNode {
	return {
		...context(input.context),
		'@type': 'ProfilePage',
		'@id': input.id,
		mainEntity: input.mainEntity,
		...(input.dateCreated === undefined ? {} : { dateCreated: input.dateCreated }),
		...(input.dateModified === undefined ? {} : { dateModified: input.dateModified }),
	};
}

export interface CollectionPageJsonLdInput extends ContextOption {
	id: string;
	name: string;
	description: string;
	url: string;
}

export function buildCollectionPageJsonLd(input: CollectionPageJsonLdInput): JsonLdNode {
	return {
		...context(input.context),
		'@type': 'CollectionPage',
		'@id': input.id,
		name: input.name,
		description: input.description,
		url: input.url,
	};
}
