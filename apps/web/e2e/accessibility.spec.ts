import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	expectAccessible,
	expectNoHorizontalOverflow,
	expectTapTargets,
} from '@yesid/config/playwright';

import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { AUDIT_NAV, LEGAL_NAV, SURFACE_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const departures = fixture('departures.json');
const pages = [
	'/',
	...[...SURFACE_NAV, ...AUDIT_NAV].map(({ href }) => href),
	...LEGAL_NAV.map(({ href }) => href),
	`/stop/${Object.keys(departures.stops)[0]}`,
	`/lines/${fixture('routes-index.json').routes[0].id}`,
	`/trip/${Object.keys(fixture('trips.json').trips)[0]}`,
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
				await page.goto(url);
				await expect(page.getByRole('main')).toBeVisible();
				await expectAccessible(page);
			});
		}

		test(`${locale}: the open menu has no serious or critical axe violations`, async ({ page }) => {
			const copy = navPillCopy[locale];
			const menu = page.getByRole('navigation', { name: copy.menu });
			await page.goto(localized(AUDIT_NAV[0].href, locale));
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
			await expect(page.getByRole('banner')).toHaveCount(1);
			await expect(page.getByRole('main')).toHaveAttribute('id', 'main');
			// The map is full-bleed and has no footer.
			await expect(page.getByRole('contentinfo')).toHaveCount(path === '/map' ? 0 : 1);
			await expectNoHorizontalOverflow(page, ['#page-scroller']);
			await expectTapTargets(page, { exclude: TAP_EXEMPT });
		});
	}
}
