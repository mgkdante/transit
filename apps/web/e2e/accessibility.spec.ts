import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	expectAccessible,
	expectNoHorizontalOverflow,
	expectTapTargets,
} from '@yesid/config/playwright';

import { navPillCopy } from '../src/lib/i18n/messages';
import { AUDIT_NAV, LEGAL_NAV, SURFACE_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';
import { tripCopy } from '../src/lib/features/trips/trips.copy';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const departures = fixture('departures.json');
const trips = fixture('trips.json').trips;
const tripId = Object.keys(trips)[0];
const lineId = fixture('routes-index.json').routes[0].id;
const line = fixture('../scripts/__fixtures__/b9/rich.json').files[`static/routes/${lineId}.json`];
const lineStopCount = line.directions.reduce(
	(count: number, direction: { stops: unknown[] }) => count + direction.stops.length,
	0,
);
const pages = [
	'/',
	...[...SURFACE_NAV, ...AUDIT_NAV].map(({ href }) => href),
	...LEGAL_NAV.map(({ href }) => href),
	`/stop/${Object.keys(departures.stops)[0]}`,
	`/lines/${lineId}`,
	`/trip/${tripId}`,
	'/trip/TEmpty',
	`/search?q=${encodeURIComponent(fixture('stops-index.json').stops[0].name)}`,
];
const localized = (href: string, locale: Locale) =>
	locale === DEFAULT_LOCALE ? href : `/${locale}${href === '/' ? '' : href}`;

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	// Inside the live data's freshness window, as data-surfaces.spec does.
	await page.clock.setFixedTime(Date.parse(departures.generated_utc) + 30_000);
});

test.describe('accessibility', { tag: '@theme' }, () => {
	for (const locale of PUBLISHED_LOCALES) {
		for (const path of pages) {
			const url = localized(path, locale);
			test(`${url} has no serious or critical axe violations`, async ({ page }) => {
				// As in the layout audit below, scan after client-side fixture data settles.
				await page.goto(url, { waitUntil: 'networkidle' });
				await expect(page.getByRole('main')).toBeVisible();
				if (path === `/lines/${line.id}`) {
					await expect(page.locator('.line-stop-link')).toHaveCount(lineStopCount);
					// Axe's label-in-name check needs the text on screen, not merely in the DOM.
					for (const [index, link] of (await page.locator('.line-stop-link').all()).entries()) {
						await link.scrollIntoViewIfNeeded();
						await link.evaluate(
							(element, index) => element.setAttribute('data-axe-stop', String(index)),
							index,
						);
						await expectAccessible(page, { include: `[data-axe-stop="${index}"]` });
					}
				}
				if (path === `/trip/${tripId}`) {
					await expect(page.locator('.trip-stop-link')).toHaveCount(trips[tripId].stops.length);
					for (const [index, link] of (await page.locator('.trip-stop-link').all()).entries()) {
						await link.scrollIntoViewIfNeeded();
						await link.evaluate(
							(element, index) => element.setAttribute('data-axe-stop', String(index)),
							index,
						);
						await expectAccessible(page, { include: `[data-axe-stop="${index}"]` });
					}
				}
				if (path === '/trip/TEmpty') {
					await expect(
						page
							.getByTestId('trip-no-stops')
							.getByText(tripCopy[locale].noPredictions, { exact: true }),
					).toBeVisible();
					await expect(page.locator('.trip-stop-link')).toHaveCount(0);
				}
				await expectAccessible(page);
				if (path === '/metrics') {
					// The former inner scroller clipped these badges out of the initial axe scan.
					for (const kind of ['not-really', 'caveat']) {
						const badge = page
							.locator(`[data-kind="${kind}"] [data-slot="typed-information-badge"]`)
							.first();
						await badge.scrollIntoViewIfNeeded();
						await badge.evaluate((element) => element.setAttribute('data-axe-badge', ''));
						await expectAccessible(page, { include: '[data-axe-badge]' });
						await badge.evaluate((element) => element.removeAttribute('data-axe-badge'));
					}
				}
			});
		}

		test(`${locale}: the open menu has no serious or critical axe violations`, async ({ page }) => {
			const copy = navPillCopy[locale];
			const menu = page.getByRole('navigation', { name: copy.menu });
			await page.goto(localized(AUDIT_NAV[0].href, locale), { waitUntil: 'networkidle' });
			await expect(async () => {
				if (!(await menu.isVisible()))
					await page.getByRole('button', { name: copy.openMenu }).click();
				await expect(menu).toBeVisible({ timeout: 1000 });
			}).toPass();
			await expectAccessible(page);
		});
	}
});

// MapLibre's own controls; its 24 px attribution toggle meets WCAG 2.5.8's minimum.
const TAP_EXEMPT = ['.maplibregl-ctrl'];

for (const locale of PUBLISHED_LOCALES) {
	for (const path of pages) {
		const url = localized(path, locale);
		test(`${url} keeps the page skeleton, fits the viewport and sizes its targets`, async ({
			page,
		}) => {
			// networkidle: the client-side data lands before the page is measured.
			await page.goto(url, { waitUntil: 'networkidle' });
			await page.keyboard.press('Tab');
			await expect(page.locator(':focus')).toHaveAttribute('href', '#main');
			await expect(page.locator(':focus')).toHaveAccessibleName(navPillCopy[locale].skipToContent);
			await page.keyboard.press('Enter');
			await expect(page.getByRole('main')).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(page.getByRole('main').locator(':focus')).toHaveCount(1);
			await expect(page.getByRole('banner')).toHaveCount(1);
			await expect(page.getByRole('main')).toHaveAttribute('id', 'main');
			// The map is full-bleed and has no footer.
			await expect(page.getByRole('contentinfo')).toHaveCount(path === '/map' ? 0 : 1);
			await expectNoHorizontalOverflow(page, ['#main-flow']);
			await expectTapTargets(page, { exclude: TAP_EXEMPT });
		});
	}
}
