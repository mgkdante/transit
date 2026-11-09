import { test } from './layout-test';
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { chartOverlaps, forwardRoute } from './layout-helpers';
import { expectLayout } from './layout-debt';
import { localizeHref } from '../src/lib/i18n/routing';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
const epoch = Date.parse(fixture('departures').generated_utc);
const line = fixture('routes-index').routes[0].id;
const stop = Object.keys(fixture('departures').stops)[0];
const trip = Object.keys(fixture('trips').trips)[0];
const pages = [
	'/',
	'/map?vehicle=layout-bus',
	'/lines',
	`/lines/${line}`,
	`/stop/${stop}`,
	'/network',
	'/hotspots',
	'/repeat-offenders',
	'/alerts',
	'/receipt',
	'/status',
	`/trip/${trip}`,
	`/search?q=${encodeURIComponent(fixture('stops-index').stops[0].name)}`,
];

for (const locale of ['en', 'fr'] as const)
	for (const state of ['fresh', 'stale', 'missing']) {
		for (const path of pages)
			test(`${locale} ${state} ${path} @layout`, async ({ page }, info) => {
				await page.clock.setFixedTime(epoch + (state === 'stale' ? 900_000 : 30_000));
				await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
				await page.route('**/v1/**', (route) =>
					forwardRoute(async () => {
						const url = new URL(route.request().url());
						url.pathname = `/__layout/${state}${url.pathname}`;
						await route.fulfill({ response: await route.fetch({ url: url.href }) });
					}),
				);
				await page.goto(localizeHref(path, locale), { waitUntil: 'networkidle' });
				await expect(page.getByRole('main')).toBeVisible();
				await page.evaluate(() => document.fonts.ready);
				await page.waitForTimeout(250);
				if (path === '/receipt') {
					await expect(page.locator('[data-slot="receipt-affected"]')).toBeVisible();
					if (state === 'missing')
						await expect(
							page.locator('[data-slot="receipt-affected"] [data-slot="absent-value"]').first(),
						).toBeVisible();
				}
				if (path.startsWith('/map')) {
					const canvas = page.locator('[data-slot="vehicle-overlay"]');
					await expect
						.poll(() =>
							canvas.evaluate(
								(el) =>
									Reflect.get(el, Symbol.for('transit.map.vehicleOverlayReceipt'))
										?.paintedBodyCount ?? 0,
							),
						)
						.toBeGreaterThan(0);
					const point = await page.evaluate(() =>
						(
							window as unknown as {
								__transitMap: { project(c: [number, number]): { x: number; y: number } };
							}
						).__transitMap.project([-73.59, 45.51]),
					);
					await page.locator('.maplibregl-canvas').click({ position: point });
					await expect(page.locator('[data-slot="detail-body"]')).toBeVisible();
					if (state === 'stale')
						await expect(page.locator('[data-slot="map-feed-stall"]')).toBeVisible();
					if (state === 'missing')
						await expect(page.locator('[data-slot="absent-value"]').first()).toBeVisible();
				}
				const overlaps = path === '/network' ? await chartOverlaps(page) : [];
				await expectLayout(page, info, overlaps);
			});
	}
