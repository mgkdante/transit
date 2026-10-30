import { expect, test, type Page } from '@playwright/test';

import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { AUDIT_NAV, SURFACE_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const destinations = [...SURFACE_NAV, ...AUDIT_NAV];
// Transit prefixes every locale but the default.
const localized = (href: string, locale: Locale) =>
	locale === DEFAULT_LOCALE ? href : `/${locale}${href}`;
const home = (locale: Locale) => (locale === DEFAULT_LOCALE ? '/' : `/${locale}`);
const start = (locale: Locale) => localized(AUDIT_NAV[0].href, locale);
const next = (locale: Locale) =>
	PUBLISHED_LOCALES[(PUBLISHED_LOCALES.indexOf(locale) + 1) % PUBLISHED_LOCALES.length];
const samePath = (href: string) => (url: URL) => url.pathname === new URL(href, url).pathname;

// SSR shows the toggle before hydration wires it; retry the click until the menu opens.
async function openMenu(page: Page, locale: Locale) {
	const menu = page.getByRole('navigation', { name: navPillCopy[locale].menu });
	await expect(async () => {
		if (!(await menu.isVisible()))
			await page.getByRole('button', { name: navPillCopy[locale].openMenu }).click();
		await expect(menu).toBeVisible({ timeout: 1000 });
	}).toPass();
	return menu;
}

// No request leaves the machine: the app and its data fixture are both local.
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

for (const locale of PUBLISHED_LOCALES) {
	const copy = navPillCopy[locale];

	test(`${locale}: the language switch round-trips from home`, async ({ page }) => {
		await page.goto(home(locale));
		for (const from of [locale, next(locale)]) {
			await page
				.getByRole('link', { name: new RegExp(`^${literal(navPillCopy[from].language)}:`) })
				.click();
			await expect(page.locator('html')).toHaveAttribute('lang', next(from));
			await expect(page).toHaveURL(samePath(home(next(from))));
		}
	});

	test(`${locale}: every menu destination shows an icon and only the current one is lit`, async ({
		page,
	}) => {
		await page.goto(start(locale));
		const menu = await openMenu(page, locale);
		for (const item of destinations) {
			const icon = menu.getByRole('link', { name: item.label[locale], exact: true }).locator('svg');
			await expect(icon).toBeVisible();
			if (item === AUDIT_NAV[0]) await expect(icon).not.toHaveCSS('fill', 'none');
			else await expect(icon).toHaveCSS('fill', 'none');
		}
	});

	test(`${locale}: the menu lists every destination, holds focus and gives it back on Escape`, async ({
		page,
	}) => {
		await page.goto(start(locale));
		const menu = await openMenu(page, locale);

		for (const item of destinations) {
			await expect(menu.getByRole('link', { name: item.label[locale], exact: true })).toBeVisible();
		}
		await expect(page.getByRole('button', { name: copy.closeMenu })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('dialog', { name: copy.menu }).locator(':focus')).toHaveCount(1);

		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		await expect(page.getByRole('button', { name: copy.openMenu })).toBeFocused();
	});

	test(`${locale}: a menu destination navigates and closes the menu`, async ({ page }) => {
		const target = destinations.at(-1)!;
		await page.goto(start(locale));
		const menu = await openMenu(page, locale);
		await menu.getByRole('link', { name: target.label[locale], exact: true }).click();

		await expect(page).toHaveURL(samePath(localized(target.href, locale)));
		await expect(menu).toBeHidden();
	});

	test(`${locale}: the language switch loads the other locale`, async ({ page }) => {
		await page.goto(start(locale));
		await page.getByRole('link', { name: new RegExp(`^${literal(copy.language)}:`) }).click();

		await expect(page).toHaveURL(samePath(start(next(locale))));
		await expect(page.locator('html')).toHaveAttribute('lang', next(locale));
	});

	test(`${locale}: the header fits the viewport and the city label is centred in its control`, async ({
		page,
	}) => {
		await page.goto(start(locale));
		const width = page.viewportSize()!.width;
		const pill = (await page.getByTestId('nav-pill').boundingBox())!;
		expect(pill.x).toBeGreaterThanOrEqual(0);
		expect(pill.x + pill.width).toBeLessThanOrEqual(width);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);

		// Text-agnostic: the visible label inside the city control, whatever the catalog provides.
		const header = page.getByRole('navigation', { name: copy.nav });
		const control = header.getByRole('combobox', { name: copy.network });
		const box = (await control.boundingBox())!;
		const label = (await header
			.locator('label', { has: page.getByRole('combobox', { name: copy.network }) })
			.getByText(/\S/)
			.filter({ visible: true })
			.boundingBox())!;
		expect(Math.abs(box.x + box.width / 2 - (label.x + label.width / 2))).toBeLessThanOrEqual(1);
		expect(Math.abs(box.y + box.height / 2 - (label.y + label.height / 2))).toBeLessThanOrEqual(1);
	});
}
