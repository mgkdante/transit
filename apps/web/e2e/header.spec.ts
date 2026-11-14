import { expect, test, type Page } from '@playwright/test';

import { navPillCopy } from '../src/lib/i18n/messages';
import { revealHeaderControls } from './header-controls';
import {
	AUDIT_NAV,
	SURFACE_NAV,
	NAV_ITEMS,
	LEGAL_NAV,
	YESID_HOUSE_LINK,
} from '../src/lib/content/nav';
import { DEFAULT_LOCALE, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const destinations = NAV_ITEMS;
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

for (const redirected of [false, true]) {
	test(`Kit 3 hook fallback ${redirected ? 'closes a redirected' : 'preserves a direct'} language switch`, async ({
		page,
	}) => {
		await page.goto('/privacy');
		await openMenu(page, 'en');
		const language = page.getByTestId('language-toggle');
		await expect(language).toHaveAttribute('data-sveltekit-reload', 'true');
		// Production keeps reload links. Exercise the native router hooks independently
		// of document departure, as in yesid.dev's Kit 3 header regression specs.
		await language.evaluate((link) => link.removeAttribute('data-sveltekit-reload'));
		if (redirected) {
			await page.route('**/fr/privacy/__data.json*', (route) =>
				route.fulfill({
					contentType: 'application/json',
					body: JSON.stringify({ type: 'redirect', location: '/fr/terms?provider=stm' }),
				}),
			);
		}
		await language.click();
		await expect(page).toHaveURL(samePath(redirected ? '/fr/terms' : '/fr/privacy'));
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
		if (redirected) {
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(page.locator('[data-testid="language-toggle"]:focus')).toHaveCount(0);
		} else {
			await expect(page.getByRole('navigation', { name: navPillCopy.fr.menu })).toBeVisible();
			await expect(language).toBeFocused();
			await page.keyboard.press('Escape');
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(page.getByRole('button', { name: navPillCopy.fr.openMenu })).toBeFocused();
		}
	});
}

for (const locale of PUBLISHED_LOCALES) {
	const copy = navPillCopy[locale];
	test(`${locale}: the menu lists its destinations in four groups`, async ({ page }) => {
		await page.goto(start(locale));
		const menu = await openMenu(page, locale);
		for (const [index, item] of NAV_ITEMS.entries()) {
			await expect(menu.getByRole('link').nth(index)).toHaveAccessibleName(item.label[locale]);
		}
		await expect(menu.getByRole('link').nth(NAV_ITEMS.length)).toHaveAccessibleName(
			`${YESID_HOUSE_LINK.label[locale]} ${copy.newTab}`,
		);
	});
	test(`${locale}: every earlier URL still answers`, async ({ page }) => {
		for (const item of [...SURFACE_NAV, ...AUDIT_NAV, ...LEGAL_NAV]) {
			await page.goto(start(locale));
			await page
				.getByTestId('footer')
				.getByRole('link', { name: item.label[locale], exact: true })
				.click();
			await expect(page).toHaveURL(samePath(localized(item.href, locale)));
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		}
	});
	test(`${locale}: a network with no alert feed has no Service alerts`, async ({ page }) => {
		await page.goto(`${start(locale)}?provider=octranspo`);
		const menu = await openMenu(page, locale);
		const name = NAV_ITEMS.find((item) => item.key === 'alerts')!.label[locale];
		await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
		await expect(page.getByTestId('footer').getByRole('link', { name, exact: true })).toHaveCount(
			0,
		);
	});

	test(`${locale}: the language switch round-trips from home`, async ({ page }) => {
		await page.goto(home(locale));
		for (const from of [locale, next(locale)]) {
			await revealHeaderControls(page, from);
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
			if (item.key === AUDIT_NAV[0].key) await expect(icon).not.toHaveCSS('fill', 'none');
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
		await revealHeaderControls(page, locale);
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
