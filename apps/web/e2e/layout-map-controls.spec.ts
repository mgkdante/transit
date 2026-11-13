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

// The legend opens first; on a laptop it must leave the Markers group in view.
for (const locale of ['en', 'fr'])
	test(`${locale} map legend stays compact at 1280x800 @layout`, async ({ page }) => {
		test.skip(page.viewportSize()!.width !== 1280, 'measured at the laptop size only');
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${locale === 'fr' ? '/fr' : ''}/map`, { waitUntil: 'networkidle' });
		const panel = page.locator('.map-filter-panel .map-filters');
		await expect(panel.locator('[data-filter-group="legend"]').getByRole('list')).toBeVisible();
		const measured = await panel.evaluate((root) => {
			const body = root.querySelector('.mf-body')!;
			const legend = root.querySelector('[data-filter-group="legend"]')!;
			const markers = root.querySelector('[data-filter-group="markers"]')!;
			const rows = [
				markers.querySelector('.mf-group-trigger')!,
				...markers.querySelectorAll('[role="checkbox"]'),
			].slice(0, 3);
			return {
				legendHeight: legend.getBoundingClientRect().height,
				scrollTop: body.scrollTop,
				bodyBottom: body.getBoundingClientRect().bottom,
				rowBottoms: rows.map((row) => row.getBoundingClientRect().bottom),
				clipped: [...legend.querySelectorAll('li, p, [data-slot="status-badge"]')].filter(
					(el) => el.scrollWidth > el.clientWidth + 1,
				).length,
				overflow: legend.scrollWidth > legend.clientWidth + 1,
			};
		});
		expect(measured.legendHeight).toBeLessThanOrEqual(170);
		expect(measured.scrollTop).toBe(0);
		expect(measured.rowBottoms).toHaveLength(3);
		for (const bottom of measured.rowBottoms)
			expect(bottom).toBeLessThanOrEqual(measured.bodyBottom);
		expect(measured.clipped).toBe(0);
		expect(measured.overflow).toBe(false);
	});
