import { expect, test } from '@playwright/test';
import { NAV_GROUPS, SEARCH_LABEL } from '../src/lib/content/nav';
import { navPillCopy } from '../src/lib/i18n/messages';
import { DEFAULT_LOCALE } from '../src/lib/i18n/config';

for (const locale of ['en', 'fr'] as const) {
	test(`${locale}: native compact controls work before hydration`, async ({ browser, baseURL }) => {
		const context = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width: 390, height: 844 },
		});
		try {
			const page = await context.newPage();
			const path = locale === DEFAULT_LOCALE ? '/privacy' : `/${locale}/privacy`;
			await page.goto(new URL(path, baseURL).href);
			const copy = navPillCopy[locale];
			const open = page.getByRole('button', { name: copy.openMenu, exact: true });
			await expect(open).toHaveAttribute('popovertarget', /.+/);
			await open.click();
			const language = page.getByTestId('language-toggle');
			await expect(language).toBeVisible();
			await expect(page.getByRole('switch', { name: copy.theme, exact: true })).toBeVisible();
			await expect(language).toHaveAttribute('data-sveltekit-reload', 'true');
			await language.click();
			const other = locale === 'en' ? 'fr' : 'en';
			await expect(page.locator('html')).toHaveAttribute('lang', other);
			await expect(page).toHaveURL(
				(url) => url.pathname === (other === DEFAULT_LOCALE ? '/privacy' : `/${other}/privacy`),
			);
		} finally {
			await context.close();
		}
	});

	for (const width of [390, 1440]) {
		test(`${locale} ${width}: compact shell and grouped keyboard menu`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(locale === DEFAULT_LOCALE ? '/metrics' : `/${locale}/metrics`, {
				waitUntil: 'networkidle',
			});
			await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
			const copy = navPillCopy[locale];
			const header = page.getByTestId('nav-pill');
			if (width === 390) {
				await expect(header.getByRole('link', { name: copy.searchAria.all })).toHaveText(
					SEARCH_LABEL[locale],
				);
				await expect(header.getByTestId('language-toggle')).toBeHidden();
				await expect(header.getByRole('button', { name: copy.refresh })).toBeHidden();
			} else {
				const refresh = header.getByRole('button', { name: copy.refresh });
				await refresh.focus();
				await expect(refresh).toBeFocused();
				await expect(refresh).toHaveCSS('outline-width', '2px');
				await expect(refresh).toHaveCSS('outline-style', 'solid');
				await expect(refresh).toHaveCSS('outline-offset', '2px');
			}
			const open = page.getByRole('button', { name: copy.openMenu });
			await open.focus();
			await page.keyboard.press('Enter');
			const dialog = page.getByRole('dialog');
			for (const group of NAV_GROUPS) {
				await expect(dialog.getByRole('heading', { name: group.label[locale] })).toBeVisible();
			}
			if (width === 390) {
				await expect(dialog.getByRole('button', { name: copy.refresh, exact: true })).toBeVisible();
				await expect(dialog.getByRole('switch', { name: copy.theme })).toBeVisible();
				await expect(dialog.getByRole('link', { name: /English \/ Français/ })).toBeVisible();
			}
			await page.keyboard.press('Escape');
			await expect(dialog).toBeHidden();
			if (width === 390) {
				await expect(header.getByRole('button', { name: copy.refresh, exact: true })).toBeHidden();
			}
			await expect(page.getByRole('button', { name: copy.openMenu })).toBeFocused();
			const footer = page.getByRole('contentinfo');
			await expect(footer).not.toContainText(/SYSTEM|SYSTÈME|\d{4}\.\d{2}\.\d{2}/);
			await expect(footer.locator('[data-slot="status-dot"]')).toHaveCount(0);
		});
	}
}
