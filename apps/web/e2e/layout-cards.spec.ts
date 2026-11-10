import { test } from './layout-test';
import { expect } from '@playwright/test';
import { localizeHref } from '../src/lib/i18n/routing';

for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr'] as const)
		for (const path of ['/lines', '/search?q=24'])
			test(`${provider} ${locale} ${path} card container rules`, async ({ page }) => {
				await page.clock.setFixedTime(Date.parse('2026-06-15T12:00:30Z'));
				await page.route('**/v1/**', async (route) => {
					const url = new URL(route.request().url());
					url.pathname = `/__layout/fresh${url.pathname.replace('/octranspo/', '/stm/')}`;
					const response = await route.fetch({ url: url.href });
					if (url.pathname.endsWith('route_reliability/index.json')) {
						await route.fulfill({
							json: { generated_utc: '2026-06-15T12:00:00Z', route_ids: ['24'] },
						});
					} else if (url.pathname.endsWith('/route_reliability/24.json')) {
						const body = await response.json();
						for (const period of body.periods)
							Object.assign(period, {
								otp_pct: 95,
								observation_count: 1000,
								on_time: 950,
								wilson_lo: 92,
								wilson_hi: 98,
							});
						await route.fulfill({ response, json: body });
					} else if (url.pathname.endsWith('routes_index.json')) {
						const body = await response.json();
						body.routes = Array.from({ length: 6 }, (_, i) => ({
							...body.routes[0],
							id: i === 0 ? '24' : `24${i}`,
							short: i === 0 ? '24' : `24${i}`,
						}));
						await route.fulfill({ response, json: body });
					} else await route.fulfill({ response });
				});
				await page.goto(
					localizeHref(`${path}${path.includes('?') ? '&' : '?'}provider=${provider}`, locale),
					{ waitUntil: 'networkidle' },
				);
				const list = page.locator('[data-slot="entity-list"]').first();
				await expect(list).toBeVisible();
				// The same viewport exercises both sides of each container boundary.
				for (const [width, columns] of [
					[743, 1],
					[744, 2],
					[1127, 2],
					[1128, 3],
				]) {
					await list.evaluate((el, width) => {
						el.parentElement!.style.width = `${width}px`;
					}, width);
					await expect
						.poll(() =>
							list.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
						)
						.toBe(columns);
				}
				const row = list.locator('[data-slot="entity-result-row"]').first();
				for (const [width, stacked] of [
					[470, false],
					[420, true],
				]) {
					await list.evaluate((el, width) => {
						el.parentElement!.style.width = `${width}px`;
					}, width);
					await row.scrollIntoViewIfNeeded();
					const status = row.locator('[data-slot="entity-result-status"]');
					await expect(status).toBeVisible();
					await expect(status.locator('[data-slot="reliability-badge"]')).toContainText('95');
					await expect
						.poll(async () => {
							const main = await row.locator('[data-slot="entity-result-main"]').boundingBox();
							const badge = await status.boundingBox();
							return badge!.y >= main!.y + main!.height;
						})
						.toBe(stacked);
				}
			});
