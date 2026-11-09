import { test } from './layout-test';
import { expect } from '@playwright/test';
import { chartOverlaps } from './layout-helpers';
import { localizeHref } from '../src/lib/i18n/routing';

for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr'] as const)
		for (const path of ['/network', '/hotspots', '/repeat-offenders'])
			test(`${provider} ${locale} chart geometry ${path}`, async ({ page }) => {
				await page.clock.setFixedTime(Date.parse('2026-08-29T12:00:30Z'));
				await page.route('**/v1/**', async (route) => {
					const url = new URL(route.request().url());
					url.pathname = `/__layout/fresh${url.pathname.replace('/octranspo/', '/stm/')}`;
					await route.fulfill({ response: await route.fetch({ url: url.href }) });
				});
				await page.goto(`${localizeHref(path, locale)}?provider=${provider}`, {
					waitUntil: 'networkidle',
				});
				for (const frame of await page.locator('[data-slot="chart-frame"]').all()) {
					if (!(await frame.isVisible())) continue;
					await frame.scrollIntoViewIfNeeded();
					await expect(frame.locator('svg').first()).toBeVisible();
					const box = await frame.boundingBox();
					expect(box!.x).toBeGreaterThanOrEqual(0);
					expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
				}
				await page.evaluate(() => document.fonts.ready);
				expect(await chartOverlaps(page)).toEqual([]);
				for (const list of await page.locator('[data-slot="stacked-rankings"]').all()) {
					const stacked = page.viewportSize()!.width < 600;
					if (stacked) await expect(list).toBeVisible();
					else await expect(list).toBeHidden();
					if (!stacked) continue;
					const bars = list.getByRole('img');
					await expect(bars.first()).toBeVisible();
					for (const row of await list.getByRole('listitem').all()) {
						const name = row.locator('[title]');
						const bar = row.getByRole('img');
						const a = await name.boundingBox(),
							b = await bar.boundingBox(),
							r = await row.boundingBox();
						expect(a && b && r).toBeTruthy();
						expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
						expect(Math.abs(b!.width - r!.width)).toBeLessThan(1);
					}
				}
			});
