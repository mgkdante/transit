import { test } from './layout-test';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const read = (name: string) =>
	JSON.parse(readFileSync(new URL('./' + name + '.json', import.meta.url), 'utf8'));
const epoch = Date.parse(read('departures').generated_utc);
const line = read('routes-index').routes[0].id;
const stop = Object.keys(read('departures').stops)[0];
const trip = Object.keys(read('trips').trips)[0];
const shots = fileURLToPath(new URL('../../../.cache/cohesion/after/', import.meta.url));
mkdirSync(shots, { recursive: true });
for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr'])
		for (const width of [390, 1440]) {
			test(
				provider + ' ' + locale + ' ' + width + ' detail page controls @layout',
				async ({ page }, info) => {
					await page.setViewportSize({ width, height: 900 });
					await page.clock.setFixedTime(epoch + 30000);
					await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
					await page.route('**/v1/**', async (route) => {
						const url = new URL(route.request().url());
						url.pathname = '/__layout/fresh' + url.pathname;
						await route.fulfill({ response: await route.fetch({ url: url.href }) });
					});
					for (const [kind, path] of [
						['line', '/lines/' + line],
						['stop', '/stop/' + stop],
						['trip', '/trip/' + trip],
					]) {
						await page.goto((locale === 'fr' ? '/fr' : '') + path + '?provider=' + provider, {
							waitUntil: 'networkidle',
						});
						await expect(page.getByRole('main')).toBeVisible();
						await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
						if (kind !== 'trip') {
							const tabs = page.locator('[data-slot="entity-detail-tabs"]');
							await expect(tabs.getByRole('tab')).toHaveCount(3);
							const first = tabs.getByRole('tab').first();
							await first.focus();
							await first.press('ArrowRight');
							await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
							await first.click();
							expect(
								(
									await new AxeBuilder({ page })
										.include('[data-slot="entity-detail-tabs"]')
										.analyze()
								).violations,
							).toEqual([]);
						}
						await page.screenshot({
							animations: 'disabled',
							path:
								shots +
								'/' +
								provider +
								'-' +
								locale +
								'-' +
								width +
								'-' +
								kind +
								'-page-' +
								info.project.name +
								'.png',
						});
					}
				},
			);
		}
