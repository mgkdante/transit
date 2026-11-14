import { expect, type Page } from '@playwright/test';
import { navPillCopy } from '../src/lib/i18n/messages';
import type { Locale } from '../src/lib/i18n/config';

/** Post-hydration journeys reveal the same signpost and theme switch in the compact menu. */
export async function revealHeaderControls(page: Page, locale: Locale): Promise<void> {
	await page.waitForLoadState('networkidle');
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
	if (await page.getByTestId('language-toggle').isVisible()) return;
	await page.getByRole('button', { name: navPillCopy[locale].openMenu }).click();
	await expect(page.getByRole('dialog', { name: navPillCopy[locale].menu })).toBeVisible();
}
