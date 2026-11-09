import { test } from './layout-test';
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const epoch = Date.parse(
	JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8')).generated_utc,
);

for (const locale of ['en', 'fr'])
	for (const viewport of [
		{ width: 844, height: 390 },
		{ width: 390, height: 844 },
	])
		test(`${locale} ${viewport.width} sheet scrolls within detents @layout`, async ({ page }) => {
			await page.setViewportSize(viewport);
			await page.clock.setFixedTime(epoch + 30_000);
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			await page.route('**/v1/**', async (route) => {
				const url = new URL(route.request().url());
				url.pathname = '/__layout/fresh' + url.pathname;
				await route.fulfill({ response: await route.fetch({ url: url.href }) });
			});
			await page.goto(`${locale === 'fr' ? '/fr' : ''}/map?focus=vehicle:layout-bus`, {
				waitUntil: 'networkidle',
			});
			await expect
				.poll(() =>
					page.evaluate(() =>
						Boolean(
							(window as unknown as { __transitMap?: { loaded: boolean } }).__transitMap?.loaded,
						),
					),
				)
				.toBe(true);
			const point = await page.evaluate(() =>
				(
					window as unknown as { __transitMap: { project(c: number[]): { x: number; y: number } } }
				).__transitMap.project([-73.59, 45.51]),
			);
			await page.locator('.maplibregl-canvas').click({ position: point });
			const sheet = page.locator('[data-slot="bottom-sheet"]');
			await expect(sheet).toBeVisible();
			const handle = sheet.getByRole('slider');
			const body = sheet.locator('[data-slot="bottom-sheet-body"]');
			for (const [key, detent] of [
				['ArrowUp', 'full'],
				['Home', 'peek'],
				['ArrowUp', 'half'],
			]) {
				await handle.press(key);
				await expect(sheet).toHaveAttribute('data-detent', detent);
				const geometry = await sheet.evaluate((el) => {
					const box = el.getBoundingClientRect();
					const body = el.querySelector<HTMLElement>('[data-slot="bottom-sheet-body"]')!;
					return {
						top: box.top,
						height: box.height,
						body: body.clientHeight,
						scroll: body.scrollHeight,
						headerBottom: el.querySelector('[data-slot="sheet-header"]')!.getBoundingClientRect()
							.bottom,
					};
				});
				expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
				expect(geometry.height).toBeLessThanOrEqual(viewport.height);
				expect(geometry.height).toBeCloseTo(
					detent === 'peek' ? 168 : viewport.height * (detent === 'half' ? 0.5 : 0.9),
					0,
				);
				expect(geometry.headerBottom).toBeLessThan(viewport.height);
				expect(geometry.body, JSON.stringify(geometry)).toBeGreaterThan(0);
				await expect
					.poll(() =>
						page
							.locator('.map-hero')
							.evaluate((el) => JSON.parse((el as HTMLElement).dataset.cameraPadding!).bottom),
					)
					.toBeCloseTo(geometry.height + 16, 0);
				await body.evaluate((el) => {
					el.scrollTop = el.scrollHeight;
				});
				await expect
					.poll(() => body.evaluate((el) => el.scrollTop + el.clientHeight - el.scrollHeight))
					.toBeGreaterThanOrEqual(-1);
				await expect(sheet.getByRole('navigation')).toBeInViewport({ ratio: 1 });
				await expect(sheet.locator('[data-slot="bottom-sheet-close"]')).toBeInViewport({
					ratio: 1,
				});
			}
			// A fixed pixel peek must also fit when the viewport is shorter than that stop.
			await page.setViewportSize({ width: viewport.width, height: 150 });
			await handle.press('Home');
			await expect
				.poll(() => sheet.evaluate((el) => el.getBoundingClientRect().height))
				.toBeLessThanOrEqual(150);
		});
