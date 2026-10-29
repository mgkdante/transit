import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { SECURITY_HEADERS } from '@yesid/seo-kit/headers';
import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { AUDIT_NAV, SURFACE_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';

const localized = (href: string, locale: Locale) =>
	locale === DEFAULT_LOCALE ? href : `/${locale}${href === '/' ? '' : href}`;
const pathOf = (href: string | null) => (href ? new URL(href).pathname : null);
const destinations = [...SURFACE_NAV, ...AUDIT_NAV];

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

for (const locale of PUBLISHED_LOCALES) {
	test(`${locale}: every destination's head names itself, its canonical and every locale`, async ({
		page,
	}) => {
		for (const { href } of destinations) {
			const path = localized(href, locale);
			const response = await page.goto(path);
			expect(response?.ok(), path).toBe(true);
			await expect(page).toHaveTitle(/\S/);
			await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
			expect(pathOf(await page.locator('link[rel="canonical"]').getAttribute('href'))).toBe(path);
			const alternates = await page
				.locator('link[rel="alternate"][hreflang]')
				.evaluateAll((links) =>
					links.map((link) => [link.getAttribute('hreflang'), link.getAttribute('href')]),
				);
			expect(alternates.map(([hreflang, url]) => [hreflang, pathOf(url)])).toEqual([
				...PUBLISHED_LOCALES.map((lang) => [lang, localized(href, lang)]),
				['x-default', localized(href, DEFAULT_LOCALE)],
			]);
			const graph = JSON.parse(
				(await page.locator('script[type="application/ld+json"]').textContent()) ?? '',
			)['@graph'] as { '@type': string }[];
			expect(graph.map((node) => node['@type'])).toContain('WebSite');
		}
	});
}

test('the share card is a PNG of the declared size', async ({ page, request }) => {
	await page.goto(localized(destinations[0]!.href, DEFAULT_LOCALE));
	const image = await page.locator('meta[property="og:image"]').getAttribute('content');
	const width = Number(
		await page.locator('meta[property="og:image:width"]').getAttribute('content'),
	);
	const height = Number(
		await page.locator('meta[property="og:image:height"]').getAttribute('content'),
	);
	const card = await request.get(pathOf(image)!);
	expect(card.headers()['content-type']).toContain('image/png');
	const bytes = await card.body();
	expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([width, height]);
});

test('documents carry the security headers and robots matches the indexing policy', async ({
	page,
	request,
}) => {
	const response = await page.goto(localized(destinations[0]!.href, DEFAULT_LOCALE));
	const headers = response!.headers();
	for (const name of [...Object.keys(SECURITY_HEADERS), 'Content-Security-Policy']) {
		expect(headers[name.toLowerCase()], name).toBeTruthy();
	}
	const robots = await (await request.get('/robots.txt')).text();
	const sitemap = await (await request.get('/sitemap.xml')).text();
	if (/^Disallow: \/$/m.test(robots)) {
		expect(headers['x-robots-tag']).toContain('noindex');
		expect(sitemap).not.toContain('<loc>');
	} else {
		const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => pathOf(loc));
		for (const { href } of destinations) {
			for (const lang of PUBLISHED_LOCALES) expect(locs).toContain(localized(href, lang));
		}
	}
});

for (const colorScheme of ['dark', 'light'] as const) {
	test(`a reload paints the stored theme before the app runs (system ${colorScheme})`, async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme });
		await page.goto(localized(destinations[0]!.href, DEFAULT_LOCALE));
		const html = page.locator('html');
		await expect(html).toHaveAttribute('data-theme', 'dark');
		const toggle = page.getByRole('switch', { name: navPillCopy[DEFAULT_LOCALE].theme });
		// Server markup shows the control before hydration wires it; retry until it responds.
		await expect(async () => {
			if ((await html.getAttribute('data-theme')) !== 'light') await toggle.click();
			await expect(html).toHaveAttribute('data-theme', 'light', { timeout: 1000 });
		}).toPass();
		await page.route('**/_app/**/*.js', (route) => route.abort());
		await page.reload();
		await expect(html).toHaveAttribute('data-theme', 'light');
	});
}

// The fixture server stands in for https://data.yesid.dev on another origin, which connect-src blocks.
const fixtureData = new URL(
	JSON.parse(readFileSync(new URL('./wrangler.json', import.meta.url), 'utf8')).vars.PUBLIC_V1_BASE,
).origin;

test('every destination runs under the real policy without a violation', async ({ page }) => {
	const violations: string[] = [];
	await page.exposeFunction('reportViolation', (directive: string, blocked: string) => {
		if (!blocked.startsWith(fixtureData)) violations.push(`${directive} ${blocked}`);
	});
	await page.addInitScript(() =>
		addEventListener('securitypolicyviolation', (event) =>
			(
				window as unknown as { reportViolation(directive: string, blocked: string): void }
			).reportViolation(event.effectiveDirective, event.blockedURI),
		),
	);
	// networkidle: hydration and the map's lazy imports are requests, so their violations land first.
	for (const { href } of destinations) await page.goto(href, { waitUntil: 'networkidle' });
	expect(violations).toEqual([]);
});
