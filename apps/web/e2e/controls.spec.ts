import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { copy as searchCopy } from '../src/lib/features/search/search.copy';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';

test.use({ bypassCSP: true });
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

for (const locale of PUBLISHED_LOCALES) {
	test(`${locale}: shared search keeps its name, typing and 44px target`, async ({ page }) => {
		await page.goto(localizeHref('/search', locale));
		const box = page.getByRole('textbox', { name: searchCopy[locale].inputLabel });
		await expect(box).toBeVisible();
		await expect(page.locator('[data-slot="listing-search-field"] svg')).toBeVisible();
		expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await expect(async () => {
			await box.fill('Sherbrooke');
			await expect(
				page
					.getByRole('main')
					.getByRole('link', { name: /Sherbrooke/ })
					.first(),
			).toBeVisible({ timeout: 1_000 });
		}).toPass();
	});
}

test('load-more keeps a visible keyboard ring and loads the next batch', async ({ page }) => {
	const source = JSON.parse(readFileSync(new URL('./routes-index.json', import.meta.url), 'utf8'));
	const template = source.routes[0];
	source.routes = Array.from({ length: 60 }, (_, index) => ({
		...template,
		id: `R${index}`,
		short: String(index + 1),
		long: `Fixture route ${index + 1}`,
	}));
	await page.route('**/static/routes_index.json', (route) => route.fulfill({ json: source }));
	await page.goto('/stops');
	const more = page.getByRole('button', { name: 'Show 10 more lines', exact: true });
	await expect(more).toBeVisible();
	await more.focus();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	await expect(more).toBeFocused();
	const ring = await more.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			visible: element.matches(':focus-visible'),
			style: style.outlineStyle,
			width: parseFloat(style.outlineWidth),
		};
	});
	expect(ring.visible).toBe(true);
	expect(ring.style).toBe('solid');
	expect(ring.width).toBeGreaterThanOrEqual(2);
	expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await page.keyboard.press('Enter');
	await expect(more).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Fixture route 60/, exact: false })).toBeVisible();
});
