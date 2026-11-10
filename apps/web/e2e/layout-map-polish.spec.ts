import { test } from './layout-test';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test.describe.configure({ mode: 'parallel' });

const epoch = Date.parse(
	JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8')).generated_utc,
);

async function stable(page: Page) {
	await page.evaluate(() => document.fonts.ready);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document
						.getAnimations()
						.filter(
							(a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity,
						).length,
			),
		)
		.toBe(0);
	let previous = '';
	let unchanged = 0;
	await expect
		.poll(
			async () => {
				const current = await page.getByTestId('nav-pill').evaluate((nav) =>
					JSON.stringify(
						[...nav.querySelectorAll('a, input, [data-slot^="wordmark-"]')].map((el) => {
							const r = el.getBoundingClientRect();
							return [r.x, r.y, r.width, r.height];
						}),
					),
				);
				unchanged = current === previous ? unchanged + 1 : 0;
				previous = current;
				return unchanged;
			},
			{ intervals: [100] },
		)
		.toBeGreaterThanOrEqual(2);
}

async function headerOverlaps(page: Page) {
	return page.getByTestId('nav-pill').evaluate((nav) => {
		const search = nav.querySelector('input[type="search"]');
		if (!search?.checkVisibility()) return [];
		const box = search.getBoundingClientRect();
		return [...nav.querySelectorAll('.nav-wordmark, .nav-links a')]
			.filter((el) => el.checkVisibility())
			.filter((el) => {
				const r = el.getBoundingClientRect();
				return (
					Math.min(r.right, box.right) - Math.max(r.left, box.left) > 1 &&
					Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) > 1
				);
			})
			.map((el) => el.textContent);
	});
}

for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr'])
		for (const active of [false, true]) {
			test(`${provider} ${locale} ${active ? 'active' : 'clear'} settled map panel polish @layout`, async ({
				page,
				browserName,
			}, info) => {
				await page.clock.setFixedTime(epoch + 900000);
				await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
				await page.route('**/v1/**', async (route) => {
					const url = new URL(route.request().url());
					url.pathname = '/__layout/stale' + url.pathname;
					await route.fulfill({ response: await route.fetch({ url: url.href }) });
				});
				const widths = page.viewportSize()!.width < 1024 ? [390] : [1440, 1280];
				for (const width of widths) {
					await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
					await page.emulateMedia({ reducedMotion: 'no-preference' });
					await page.goto(
						`${locale === 'fr' ? '/fr' : ''}/map?provider=${provider}${active ? '&route=24&vehicle=layout-bus' : ''}`,
						{ waitUntil: 'networkidle' },
					);
					await stable(page);
					expect(await headerOverlaps(page), 'header after fonts load').toEqual([]);
					await page.emulateMedia({ reducedMotion: 'reduce' });
					if (width === 390) await page.getByTestId('map-filter-pill').click();
					const panel = page.locator('.map-filters:visible');
					const sw = panel.getByRole('switch', {
						name: locale === 'fr' ? 'Positions estimées' : 'Estimated positions',
						exact: true,
					});
					await expect(sw).toBeDisabled();
					const heading = panel.getByRole('heading', { name: 'Positions' });
					const h = (await heading.boundingBox())!;
					const row = (await sw.boundingBox())!;
					expect(row.y).toBeGreaterThanOrEqual(h.y + h.height);
					expect(Math.abs(row.x - h.x)).toBeLessThan(1);
					const label = await sw.locator('.map-motion-state').evaluate((el) => ({
						height: el.getBoundingClientRect().height,
						line: parseFloat(getComputedStyle(el).lineHeight),
					}));
					expect(label.height).toBeLessThanOrEqual(label.line + 1);
					if (active) {
						const remove = panel.getByRole('button', {
							name:
								locale === 'fr'
									? 'Retirer le filtre : 24 Sherbrooke'
									: 'Remove filter: 24 Sherbrooke',
							exact: true,
						});
						await expect(remove).toBeVisible();
						expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
						expect(
							(await remove.locator('[data-slot="badge"]').boundingBox())!.height,
						).toBeLessThanOrEqual(30);
						await expect(remove).toContainText('×');
					}
					expect(
						(
							await new AxeBuilder({ page })
								.include('.map-filters')
								.include('[data-testid="nav-pill"]')
								.analyze()
						).violations,
					).toEqual([]);
					await stable(page);
					if (process.env.TRANSIT_POLISH_SHOTS) {
						const dir = fileURLToPath(
							new URL('../../../.cache/cohesion/after/controls', import.meta.url),
						);
						mkdirSync(dir, { recursive: true });
						await page.screenshot({
							path: resolve(
								dir,
								`${browserName}-${provider}-${locale}-${width}-${active ? 'active' : 'clear'}-${info.project.use.colorScheme}.png`,
							),
							animations: 'disabled',
						});
						if (active) {
							await panel
								.getByRole('button', {
									name: /^(Remove filter:|Retirer le filtre :) 24 Sherbrooke$/,
								})
								.scrollIntoViewIfNeeded();
							await page.screenshot({
								path: resolve(
									dir,
									`${browserName}-${provider}-${locale}-${width}-active-filters-${info.project.use.colorScheme}.png`,
								),
								animations: 'disabled',
							});
						}
					}
					if (active) {
						await panel
							.getByRole('button', {
								name: new RegExp(
									`${locale === 'fr' ? 'Retirer le filtre :' : 'Remove filter:'} 24 Sherbrooke`,
								),
							})
							.click();
						await expect(page).not.toHaveURL(/[?&]route=24(?:&|$)/);
					}
				}
			});
		}
