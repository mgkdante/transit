import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectAccessible } from '@yesid/config/playwright';

import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { AUDIT_NAV, SURFACE_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const departures = fixture('departures.json');
const pages = [
	'/',
	...[...SURFACE_NAV, ...AUDIT_NAV].map(({ href }) => href),
	`/stop/${Object.keys(departures.stops)[0]}`,
	`/trip/${Object.keys(fixture('trips.json').trips)[0]}`,
];
const localized = (href: string, locale: Locale) =>
	locale === DEFAULT_LOCALE ? href : `/${locale}${href === '/' ? '' : href}`;
// Failing today; C10 fixes each one and deletes it here.
const KNOWN: string[] = [];

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
				await expectAccessible(page, { exclude: KNOWN });
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
			await expectAccessible(page, { exclude: KNOWN });
		});
	}
});
