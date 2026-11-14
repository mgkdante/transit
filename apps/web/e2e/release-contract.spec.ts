import { expect, test } from '@playwright/test';
import { DEFAULT_LOCALE } from '../src/lib/i18n/config';

for (const locale of ['en', 'fr'] as const) {
	test(`${locale}: real section prose stays open until its heading is activated`, async ({
		page,
	}) => {
		await page.goto(locale === DEFAULT_LOCALE ? '/metrics' : `/${locale}/metrics`);
		// SSR exposes the expanded section before hydration wires its interactions.
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
		const section = page.locator('[data-testid="metrics-sections"] .section-card').first();
		const heading = section.locator('[data-section-trigger]');
		await expect(heading).toHaveAttribute('aria-expanded', 'true');
		await section.locator('[data-slot="collapsible-content"] p').first().click();
		await expect(heading).toHaveAttribute('aria-expanded', 'true');
		await heading.focus();
		await page.keyboard.press('Space');
		await expect(heading).toHaveAttribute('aria-expanded', 'false');
	});
}
