import { test } from './layout-test';
import { expect } from '@playwright/test';
import { textDefects } from './layout-helpers';
import { knownTextDefect } from './layout-debt';
import { readFileSync } from 'node:fs';
// Run with TRANSIT_E2E_PANEL_SIZES=1 so server boot uses the rich provider fixtures.
const epoch = Date.parse(
	JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8')).generated_utc,
);
test.describe.configure({ mode: 'parallel' });
test.afterEach(async ({ page }) => {
	await page.unrouteAll({ behavior: 'wait' });
});
for (const locale of ['en', 'fr'])
	for (const provider of ['stm', 'octranspo']) {
		test(locale + ' ' + provider + ' desktop panel snaps @layout', async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.clock.setFixedTime(epoch + 900000);
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			await page.route('**/v1/**', async (route) => {
				const url = new URL(route.request().url());
				url.pathname = '/__layout/stale' + url.pathname;
				await route.fulfill({ response: await route.fetch({ url: url.href }) });
			});
			await page.goto(
				(locale === 'fr' ? '/fr' : '') + '/map?provider=' + provider + '&focus=vehicle:layout-bus',
				{ waitUntil: 'networkidle' },
			);
			await expect
				.poll(() =>
					page
						.locator('[data-slot="vehicle-overlay"]')
						.evaluate(
							(el) =>
								Reflect.get(el, Symbol.for('transit.map.vehicleOverlayReceipt'))
									?.paintedBodyCount ?? 0,
						),
				)
				.toBeGreaterThan(0);
			const point = await page.evaluate(
				(provider) =>
					(
						window as unknown as {
							__transitMap: { project(c: number[]): { x: number; y: number } };
						}
					).__transitMap.project(provider === 'stm' ? [-73.59, 45.51] : [-75.69, 45.41]),
				provider,
			);
			await page.locator('.maplibregl-canvas').click({ position: point });
			const handle = page.locator('[data-slot="map-detail-handle"]');
			await expect(handle).toBeVisible();
			const left = page.locator('.map-filters [role="separator"]');
			for (const leftWidth of [56, 300]) {
				await left.press(leftWidth === 56 ? 'Home' : 'End');
				for (const [key, width] of [
					['Home', 56],
					['ArrowLeft', 320],
					['ArrowLeft', 400],
					['End', 560],
				] as const) {
					await handle.press(key);
					await expect(handle).toHaveAttribute('aria-valuenow', String(width));
					await expect
						.poll(() =>
							page
								.locator('.map-hero')
								.evaluate(
									(el) => JSON.parse((el as HTMLElement).dataset.cameraPadding ?? '{}').right,
								),
						)
						.toBe(width + 16);
					await expect
						.poll(() =>
							page
								.locator('.map-hero')
								.evaluate(
									(el) => JSON.parse((el as HTMLElement).dataset.cameraPadding ?? '{}').left,
								),
						)
						.toBe(leftWidth === 56 ? 16 : leftWidth + 32);
					const defects = await textDefects(page);
					expect(
						defects.filter((finding) => !knownTextDefect(finding)),
						'new page layout defects',
					).toEqual([]);
					expect(
						defects.filter((d) => d.selector.startsWith('#map-filter-controls-desktop')),
					).toEqual([]);
					const banner = page.locator('.map-live-edge');
					expect((await banner.boundingBox())!.width).toBeGreaterThan(260);
				}
			}
			for (const width of [56, 320, 400, 560]) {
				const box = (await handle.boundingBox())!;
				const current = Number(await handle.getAttribute('aria-valuenow'));
				await page.mouse.move(box.x + box.width / 2, box.y + 100);
				await page.mouse.down();
				await page.mouse.move(box.x + box.width / 2 + current - width, box.y + 100, { steps: 5 });
				await page.mouse.up();
				await expect(handle).toHaveAttribute('aria-valuenow', String(width));
			}
			await page.reload({ waitUntil: 'networkidle' });
			await expect
				.poll(() =>
					page
						.locator('[data-slot="vehicle-overlay"]')
						.evaluate(
							(el) =>
								Reflect.get(el, Symbol.for('transit.map.vehicleOverlayReceipt'))
									?.paintedBodyCount ?? 0,
						),
				)
				.toBeGreaterThan(0);
			const again = await page.evaluate(
				(provider) =>
					(
						window as unknown as {
							__transitMap: { project(c: number[]): { x: number; y: number } };
						}
					).__transitMap.project(provider === 'stm' ? [-73.59, 45.51] : [-75.69, 45.41]),
				provider,
			);
			await page.locator('.maplibregl-canvas').click({ position: again });
			await expect(handle).toHaveAttribute('aria-valuenow', '560');
		});
	}
