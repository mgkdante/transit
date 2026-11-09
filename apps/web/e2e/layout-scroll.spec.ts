import { expect } from '@playwright/test';
import { test } from './layout-test';

for (const provider of ['stm', 'octranspo']) {
	for (const prefix of ['', '/fr']) {
		test(`${provider} ${prefix || 'en'} content scrolls the window and map stays in the viewport`, async ({
			page,
		}) => {
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			await page.goto(`${prefix}/privacy?provider=${provider}`);
			await expect(page.locator('#page-scroller')).toHaveCount(0);
			await expect
				.poll(() => page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight))
				.toBeGreaterThan(0);
			await page.evaluate(() => window.scrollTo(0, 250));
			await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
			const chrome = page.locator('[data-slot="app-shell-chrome"]');
			expect((await chrome.boundingBox())!.y).toBe(0);
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.locator('a[href="#main"]').focus();
			await expect(page.locator('a[href="#main"]')).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(page.getByRole('main')).toBeFocused();
			// Exercise an actual in-page anchor with the fixed chrome offset.
			const anchor = page.locator('main [id]').last();
			const id = await anchor.getAttribute('id');
			expect(id).toBeTruthy();
			await page.evaluate((id) => {
				const link = document.createElement('a');
				link.href = `#${id}`;
				document.body.append(link);
				link.click();
				link.remove();
			}, id!);
			await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
			await expect(anchor).toBeInViewport();
			await page.goto(`${prefix}/map?provider=${provider}`);
			await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
				'data-full-viewport',
				'true',
			);
			await page.evaluate(() => window.scrollTo(0, 250));
			expect(await page.evaluate(() => scrollY)).toBe(0);
			expect(
				await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight),
			).toBeLessThanOrEqual(1);
		});
	}
}
