import { test } from './layout-test';
import { expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import providers from './providers.json' with { type: 'json' };

const sizes = [
	[1920, 1080],
	[1536, 864],
	[1600, 900],
	[1440, 900],
	[1280, 800],
	[2560, 1440],
];
const phase = process.env.TRANSIT_FRAMING_PHASE ?? 'after';
test.describe.configure({ mode: 'parallel' });
async function sample(page: Page, bounds: number[]) {
	return page.evaluate((b) => {
		const map = document.querySelector('[data-slot="map-stage"]')!.getBoundingClientRect();
		const panel = document.querySelector('.map-filter-panel')!.getBoundingClientRect();
		const detail = document
			.querySelector('[data-slot="map-detail-overlay"]')
			?.getBoundingClientRect();
		const probe = (
			window as unknown as { __transitMap: { project(c: number[]): { x: number; y: number } } }
		).__transitMap;
		const center = probe.project([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
		const west = probe.project([b[0], b[3]]).x;
		const east = probe.project([b[2], b[3]]).x;
		const left = panel.width > 56 ? panel.right - map.left : 0;
		const right = detail?.width ?? 0;
		const padding = JSON.parse(
			(document.querySelector('.map-hero') as HTMLElement).dataset.cameraPadding ?? '{}',
		);
		return {
			center,
			west,
			east,
			expectedX: Math.max(
				left ? left + 16 + (east - west) / 2 : 16 + (east - west) / 2,
				Math.min(map.width / 2, map.width - right - 16 - (east - west) / 2),
			),
			viewportCenter: { x: map.width / 2, y: map.height / 2 },
			visibleCenter: {
				x: (map.width + left - right) / 2,
				y: (map.height + padding.top - padding.bottom) / 2,
			},
			panel: { left: panel.left, width: panel.width, right: panel.right - map.left },
			padding,
		};
	}, bounds);
}
for (const provider of providers.providers)
	for (const [width, height] of sizes)
		for (const locale of ['en', 'fr']) {
			const mapPath = locale === 'fr' ? '/fr/map' : '/map';
			test(`${locale} ${provider.id} provider center ${width}x${height} @layout`, async ({
				page,
			}, info) => {
				await page.setViewportSize({ width, height });
				await page.clock.setFixedTime(Date.parse('2026-06-15T12:00:30Z'));
				await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
				await page.goto(`${mapPath}?provider=${provider.id}`, { waitUntil: 'networkidle' });
				await expect
					.poll(() =>
						page.evaluate(
							() =>
								(window as unknown as { __transitMap?: { loaded: boolean; moving: boolean } })
									.__transitMap?.loaded ?? 'probe absent',
						),
					)
					.toBe(true);
				const dir = resolve(
					'../../.cache/map-framing',
					phase,
					...(locale === 'en' && info.project.use.colorScheme === 'light'
						? []
						: [`${locale}-${info.project.use.colorScheme}`]),
				);
				await mkdir(dir, { recursive: true });
				const measurements: Record<string, unknown> = {};
				const states =
					process.env.TRANSIT_E2E_PANEL_SIZES === '1'
						? ['default', 'rail', 'right-open']
						: ['default', 'rail'];
				for (const state of states) {
					if (state === 'rail') await page.locator('.map-filters [role="separator"]').press('Home');
					if (state === 'right-open') {
						await page.goto(`${mapPath}?provider=${provider.id}&focus=vehicle:layout-bus`, {
							waitUntil: 'networkidle',
						});
						const coord = provider.id === 'stm' ? [-73.59, 45.51] : [-75.69, 45.41];
						await expect
							.poll(() =>
								page.evaluate(() =>
									Boolean(
										(window as unknown as { __transitMap?: { loaded: boolean } }).__transitMap
											?.loaded,
									),
								),
							)
							.toBe(true);
						const p = await page.evaluate(
							(c) =>
								(
									window as unknown as {
										__transitMap: { project(c: number[]): { x: number; y: number } };
									}
								).__transitMap.project(c),
							coord,
						);
						await page.locator('.maplibregl-canvas').click({ position: p });
						await expect(page.locator('[data-slot="map-detail-handle"]')).toBeVisible();
						const focus = await page.evaluate((c) => {
							const p = (
								window as unknown as {
									__transitMap: { project(c: number[]): { x: number; y: number } };
								}
							).__transitMap.project(c);
							const panel = document
								.querySelector('[data-slot="map-detail-overlay"]')!
								.getBoundingClientRect();
							return { x: p.x, limit: panel.left };
						}, coord);
						expect(focus.x).toBeLessThan(focus.limit);
					}
					await expect
						.poll(() =>
							page.evaluate(
								() =>
									(window as unknown as { __transitMap: { moving: boolean } }).__transitMap.moving,
							),
						)
						.toBe(false);
					// Panel layout and its ResizeObserver camera update settle on separate frames.
					if (phase === 'after' && state !== 'right-open')
						await expect
							.poll(async () => {
								const m = await sample(page, provider.fit_bounds);
								return Math.abs(m.center.x - m.expectedX);
							})
							.toBeLessThan(3);
					const name = `${provider.id}-${width}x${height}-${state}`;
					measurements[state] = await sample(page, provider.fit_bounds);
					await page.screenshot({ path: resolve(dir, `${name}.png`) });
				}
				await writeFile(
					resolve(dir, `${provider.id}-${width}x${height}.json`),
					JSON.stringify(measurements, null, 2),
				);
				if (phase === 'after')
					for (const state of ['default', 'rail']) {
						const m = measurements[state] as Awaited<ReturnType<typeof sample>>;
						expect(Math.abs(m.center.x - m.expectedX), state).toBeLessThan(3);
						if (state === 'default') expect(m.west).toBeGreaterThanOrEqual(m.panel.right + 15);
						expect(Math.abs(m.center.y - m.visibleCenter.y), state).toBeLessThan(3);
					}
			});
		}
