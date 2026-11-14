import { test } from './layout-input-test';
import { expect, type Page } from '@playwright/test';
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
// The phone view pill must not cover the record's first heading, as loaded or scrolled to it.
const pillCoversHeading = (page: Page) =>
	page.evaluate(() => {
		const pill = document.querySelector('[data-slot="surface-rail-mobile"] > button');
		const heading = document.querySelector('[data-slot="reliability-rail-content"] :is(h2, h3)');
		if (!pill || !heading) return 'missing';
		const overlap = () => {
			const [p, h] = [pill, heading].map((el) => el.getBoundingClientRect());
			return p.top < h.bottom && h.top < p.bottom && p.left < h.right && h.left < p.right;
		};
		const atLoad = overlap();
		heading.scrollIntoView({ block: 'end', behavior: 'instant' });
		return atLoad || overlap();
	});
for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr'])
		test(`${provider} ${locale} 390 line view pill clears the record heading @layout`, async ({
			page,
		}) => {
			const path = (locale === 'fr' ? '/fr' : '') + '/lines/' + line + '?provider=' + provider;
			await page.setViewportSize({ width: 390, height: 844 });
			await page.clock.setFixedTime(epoch + 30000);
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			// First paint: the server markup, with the app's scripts held back.
			await page.route('**/_app/immutable/**/*.js', (route) => route.abort());
			await page.goto(path);
			await expect(page.locator('html')).not.toHaveAttribute('data-hydrated', '');
			expect(await pillCoversHeading(page)).toBe(false);
			await page.unroute('**/_app/immutable/**/*.js');
			await page.goto(path, { waitUntil: 'networkidle' });
			await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
			expect(await pillCoversHeading(page)).toBe(false);
		});
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
							await expect(first).toHaveAttribute('aria-selected', 'true');
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
