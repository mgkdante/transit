import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { AUDIT_NAV, SURFACE_NAV } from '../src/lib/content/nav';
import { copy as healthCopy } from '../src/lib/features/health/health.copy';
import { PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const catalog = fixture('providers.json');
const other: string = catalog.providers.find(
	({ id }: { id: string }) => id !== catalog.default_provider,
).id;
const stop = fixture('stops-index.json').stops[0].id;
const line = fixture('routes-index.json').routes[0].id;
const lanes: { lane: keyof (typeof healthCopy)['en']['lanes']['laneLabel'] }[] =
	fixture('data-health.json').lanes;
const [map, lines] = ['map', 'lines'].map(
	(key) => SURFACE_NAV.find((item) => item.key === key)!.href,
);
const status = AUDIT_NAV.find((item) => item.key === 'status')!.href;

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

// The picker reloads the page; before hydration a choice does nothing, so retry until the URL changes.
async function switchProvider(page: Page, locale: Locale) {
	const picker = page
		.getByRole('navigation', { name: navPillCopy[locale].nav })
		.getByRole('combobox', { name: navPillCopy[locale].network });
	await expect(async () => {
		await picker.selectOption(other);
		await expect(page).toHaveURL((url) => url.searchParams.get('provider') === other, {
			timeout: 1_000,
		});
	}).toPass();
}

for (const locale of PUBLISHED_LOCALES) {
	const health = healthCopy[locale];
	const next =
		PUBLISHED_LOCALES[(PUBLISHED_LOCALES.indexOf(locale) + 1) % PUBLISHED_LOCALES.length];

	test(`${locale}: the network picker reloads the status page with that provider's data`, async ({
		page,
	}) => {
		await page.goto(localizeHref(status, locale));
		const allClear = page.getByText(health.aggregate.allClear);
		await expect(allClear).toHaveCount(0);
		await switchProvider(page, locale);

		await expect(page).toHaveURL((url) => url.pathname === localizeHref(status, locale));
		// The rail repeats the verdict but is hidden below 1024px.
		await expect(allClear.filter({ visible: true }).first()).toBeVisible();
		const list = page.getByRole('list', { name: health.lanes.listLabel });
		for (const { lane } of lanes) {
			await expect(list.getByText(health.lanes.laneLabel[lane], { exact: true })).toBeVisible();
		}
	});

	for (const [from, listing] of [
		[`/stop/${stop}`, map],
		[`/lines/${line}`, lines],
	]) {
		test(`${locale}: switching provider on ${from} lands on ${listing}`, async ({ page }) => {
			await page.goto(localizeHref(from, locale));
			await switchProvider(page, locale);
			await expect(page).toHaveURL((url) => url.pathname === localizeHref(listing, locale));
		});
	}

	test(`${locale}: the language switch keeps the chosen provider`, async ({ page }) => {
		await page.goto(localizeHref(status, locale, other));
		await page
			.getByRole('link', { name: new RegExp(`^${literal(navPillCopy[locale].language)}:`) })
			.click();
		await expect(page).toHaveURL(
			(url) => url.pathname + url.search === localizeHref(status, next, other),
		);
	});
}
