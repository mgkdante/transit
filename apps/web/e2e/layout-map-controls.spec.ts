import { test } from './layout-test';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr']) {
		test(`${provider} ${locale} map controls align and work by keyboard @layout`, async ({
			page,
		}) => {
			await page.goto(`${locale === 'fr' ? '/fr' : ''}/map?provider=${provider}`, {
				waitUntil: 'networkidle',
			});
			if (page.viewportSize()!.width < 1024) await page.getByTestId('map-filter-pill').click();
			const panel = page.locator('.map-filters:visible');
			const stop = panel.getByRole('checkbox', {
				name: locale === 'fr' ? 'Arrêt' : 'Stop',
				exact: true,
			});
			await expect(stop).toHaveAttribute('aria-checked', 'false');
			await stop.press('Space');
			await expect(stop).toHaveAttribute('aria-checked', 'true');
			await expect(page).toHaveURL(/[?&]entity=stop(?:&|$)/);
			await stop.press('Enter');
			await expect(stop).toHaveAttribute('aria-checked', 'false');
			const heading = panel.locator('[data-filter-group="markers"] .mf-group-trigger');
			const row = await stop.boundingBox();
			const header = await heading.boundingBox();
			expect(Math.abs(row!.x - header!.x)).toBeLessThan(1);
			expect(Math.abs(row!.width - header!.width)).toBeLessThan(1);
			expect(row!.height).toBeGreaterThanOrEqual(44);
			expect(await stop.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
			expect((await new AxeBuilder({ page }).include('.map-filters').analyze()).violations).toEqual(
				[],
			);
		});
	}
