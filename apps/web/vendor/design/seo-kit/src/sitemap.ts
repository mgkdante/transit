const XML_ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	"'": '&apos;',
	'"': '&quot;',
};

export function xmlEscape(value: string): string {
	return value.replace(/[&<>'"]/g, (character) => XML_ESCAPES[character] ?? character);
}

export function toW3CDate(stamp: string | null | undefined): string | null {
	const value = stamp?.trim();
	if (!value) return null;
	const milliseconds = Date.parse(value);
	if (Number.isNaN(milliseconds)) return null;
	return new Date(milliseconds).toISOString();
}

export interface SitemapVariant {
	hreflang: string;
	href: string;
}

export interface AlternateSitemapEntriesInput {
	variants: readonly SitemapVariant[];
	xDefaultHref?: string;
	lastmod?: string | null;
	emptyElementStyle: 'compact' | 'spaced';
}

export function emitAlternateSitemapEntries(input: AlternateSitemapEntriesInput): string[] {
	const close = input.emptyElementStyle === 'spaced' ? ' />' : '/>';
	const lastmod = toW3CDate(input.lastmod);
	const links = [
		...input.variants,
		...(input.xDefaultHref === undefined
			? []
			: [{ hreflang: 'x-default', href: input.xDefaultHref }]),
	];

	return input.variants.map((variant) => {
		const lastmodLine = lastmod === null ? '' : `\n    <lastmod>${lastmod}</lastmod>`;
		const alternateLines = links
			.map(
				(link) =>
					`    <xhtml:link rel="alternate" hreflang="${xmlEscape(link.hreflang)}" href="${xmlEscape(link.href)}"${close}`,
			)
			.join('\n');
		return `  <url>\n    <loc>${xmlEscape(variant.href)}</loc>${lastmodLine}\n${alternateLines}\n  </url>`;
	});
}

export interface SitemapDocumentOptions {
	trailingNewline?: boolean;
}

export function emitSitemapDocument(
	entries: readonly string[],
	options: SitemapDocumentOptions = {},
): string {
	const document =
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
		entries.join('\n') +
		'\n</urlset>';
	return options.trailingNewline ? `${document}\n` : document;
}

export interface RobotsTxtInput {
	/** False keeps the host out of search: every path is disallowed. */
	indexing: boolean;
	/** Absolute sitemap URL. */
	sitemap?: string;
	disallow?: readonly string[];
	/** Comment lines after the sitemap, without the leading `#`. */
	notes?: readonly string[];
}

export function robotsTxt(input: RobotsTxtInput): string {
	if (!input.indexing) return 'User-agent: *\nDisallow: /\n';
	const lines = ['User-agent: *', 'Allow: /', ...(input.disallow ?? []).map((path) => `Disallow: ${path}`)];
	if (input.sitemap) lines.push('', `Sitemap: ${input.sitemap}`);
	if (input.notes?.length) lines.push('', ...input.notes.map((note) => `# ${note}`));
	return `${lines.join('\n')}\n`;
}
