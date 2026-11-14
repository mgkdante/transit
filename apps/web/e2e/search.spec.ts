import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { navPillCopy } from '../src/lib/i18n/messages';
import { SURFACE_NAV } from '../src/lib/content/nav';
import { copy as searchCopy } from '../src/lib/features/search/search.copy';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stop = fixture('stops-index.json').stops[0];
const line = fixture('routes-index.json').routes[0];
const stops = SURFACE_NAV.find((item) => item.key === 'stops')!.href;
const map = SURFACE_NAV.find((item) => item.key === 'map')!.href;
const address = {
	lat: stop.lat,
	lon: stop.lon,
	label: 'Fixture address',
	source: 'geo_ca',
	precision: 'address',
};

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.route('**/api/geocode**', (route) => route.fulfill({ json: { results: [address] } }));
});

for (const locale of PUBLISHED_LOCALES) {
	const nav = navPillCopy[locale];
	for (const provider of ['stm', 'octranspo']) {
		test(`${locale}/${provider}: home invitation opens the existing search page`, async ({
			page,
		}) => {
			await page.goto(localizeHref(`/?provider=${provider}`, locale));
			await page
				.locator('[data-slot="home-search"]')
				.getByRole('link', {
					name:
						locale === 'en'
							? 'Search for your line or stop'
							: 'Cherchez votre ligne ou votre arrêt',
				})
				.click();
			await expect(page).toHaveURL((url) => url.pathname === localizeHref('/search', locale));
			await expect(
				page.getByRole('textbox', { name: searchCopy[locale].inputLabel }),
			).toBeVisible();
		});
	}

	test(`${locale}: the header search finds a stop and Enter opens it`, async ({ page }, {
		project,
	}) => {
		test.skip(project.name !== 'desktop', 'the header search box shows from 1024px');
		await page.goto(localizeHref(stops, locale));
		const box = page.getByRole('searchbox', { name: nav.searchAria.stop });
		const result = page
			.getByRole('group', { name: nav.searchAria.stop })
			.getByRole('button', { name: new RegExp(literal(stop.name)) });
		// Hydration can reset the box; retry until the results answer.
		await expect(async () => {
			await box.fill(stop.name);
			await expect(result).toBeVisible({ timeout: 1_000 });
		}).toPass();
		await box.press('Enter');
		await expect(page).toHaveURL(
			(url) => url.pathname === localizeHref(`/stop/${stop.id}`, locale),
		);
	});

	test(`${locale}: the header search hands an address to the map`, async ({ page }, {
		project,
	}) => {
		test.skip(project.name !== 'desktop', 'the header search box shows from 1024px');
		await page.goto(localizeHref('/', locale));
		const box = page.getByRole('searchbox', { name: nav.searchAria.all });
		const result = page
			.getByRole('group', { name: nav.searchAria.all })
			.getByRole('button', { name: new RegExp(literal(address.label)) });
		await expect(async () => {
			await box.fill(address.label);
			await expect(result).toBeVisible({ timeout: 1_000 });
		}).toPass();
		await result.click();
		await expect(page).toHaveURL((url) => url.pathname === localizeHref(map, locale));
		// The map takes the address as its near-me origin and lists the stop beside it.
		await expect(
			page.getByRole('button', { name: new RegExp(`^${literal(stop.name)}`) }),
		).toBeVisible();
	});

	// Fills the header field until hydration keeps the value and the row answers.
	async function headerRow(page: Page, scope: 'all' | 'route', query: string, row: string) {
		const result = page
			.getByRole('group', { name: nav.searchAria[scope] })
			.getByRole('button', { name: new RegExp(`^${literal(row)}`) });
		await expect(async () => {
			await page.getByRole('searchbox', { name: nav.searchAria[scope] }).fill(query);
			await expect(result).toBeVisible({ timeout: 1_000 });
		}).toPass();
		return result;
	}
	const lineRow = (entry: typeof line) => `${nav.searchKind.route} ${entry.short} ${entry.long}`;

	test(`${locale}: the header search opens a line page from the home page`, async ({ page }, {
		project,
	}) => {
		test.skip(project.name !== 'desktop', 'the header search box shows from 1024px');
		await page.goto(localizeHref('/', locale));
		await (await headerRow(page, 'all', line.long, lineRow(line))).click();
		await expect(page).toHaveURL(
			(url) => url.pathname === localizeHref(`/lines/${line.id}`, locale),
		);
	});

	test(`${locale}: on the map the header search keeps map focus`, async ({ page }, { project }) => {
		test.skip(project.name !== 'desktop', 'the header search box shows from 1024px');
		await page.goto(localizeHref(map, locale));
		await (await headerRow(page, 'all', line.long, lineRow(line))).click();
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === localizeHref(map, locale) &&
				url.searchParams.get('focus') === `route:${line.id}`,
		);
	});

	test(`${locale}: from a line's reliability tab another line opens on the same tab and period`, async ({
		page,
	}, { project }) => {
		test.skip(project.name !== 'desktop', 'the header search box shows from 1024px');
		const other = fixture('routes-index.json').routes[1];
		await page.goto(localizeHref(`/lines/${line.id}?tab=reliability&grain=month`, locale));
		const row = await headerRow(page, 'route', other.short, lineRow(other));
		const grain = new URL(page.url()).searchParams.get('grain');
		await row.click();
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === localizeHref(`/lines/${other.id}`, locale) &&
				url.searchParams.get('tab') === 'reliability' &&
				url.searchParams.get('grain') === grain,
		);
	});

	test(`${locale}: below 1024px the header search opens the search page`, async ({ page }, {
		project,
	}) => {
		test.skip(project.name === 'desktop', 'desktop headers carry the search box');
		await page.goto(localizeHref('/', locale));
		await page.getByRole('link', { name: nav.searchAria.all, exact: true }).click();
		await expect(page.getByRole('textbox', { name: searchCopy[locale].inputLabel })).toBeVisible();
	});

	test(`${locale}: the search page finds a line and a stop by name`, async ({ page }) => {
		for (const [query, path] of [
			[line.long, `/lines/${line.id}`],
			[stop.name, `/stop/${stop.id}`],
		]) {
			await page.goto(localizeHref(`/search?q=${encodeURIComponent(query)}`, locale));
			await expect(
				page
					.getByRole('main')
					.getByRole('link', { name: new RegExp(literal(query)) })
					.first(),
			).toHaveAttribute('href', new RegExp(`^${literal(localizeHref(path, locale))}(\\?|$)`));
		}
	});
}
