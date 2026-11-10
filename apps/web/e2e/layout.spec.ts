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
	'/stops',
	'/stops?q=Fixture',
	`/stops?route=${line}`,
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
					forwardRoute(page, async () => {
						const url = new URL(route.request().url());
						url.pathname = `/__layout/${state}${url.pathname}`;
						await route.fulfill({ response: await route.fetch({ url: url.href }) });
					}),
				);
				await page.goto(localizeHref(path, locale), { waitUntil: 'networkidle' });
				if (path.startsWith('/stops?q='))
					await page.getByTestId('stops-filter-input').fill('Fixture');
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

for (const locale of ['en', 'fr'] as const)
	for (const provider of ['stm', 'octranspo'])
		test(`${locale} ${provider} trip long names stay readable @layout`, async ({ page }) => {
			const name =
				'Station Université de Montréal / Boulevard Édouard-Montpetit et chemin de la Côte-des-Neiges / Terminus des voyageurs';
			await page.clock.setFixedTime(epoch + 30_000);
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			await page.route('**/v1/**', async (route) => {
				const url = new URL(route.request().url());
				url.pathname = `/__layout/fresh${url.pathname.replace('/octranspo/', '/stm/')}`;
				const response = await route.fetch({ url: url.href });
				if (url.pathname.endsWith('/stops_index.json')) {
					const body = await response.json();
					for (const stop of body.stops) stop.name = name;
					await route.fulfill({ response, json: body });
				} else await route.fulfill({ response });
			});
			await page.goto(localizeHref(`/trip/${trip}?provider=${provider}`, locale), {
				waitUntil: 'networkidle',
			});
			const link = page.locator('.trip-stop-link').first();
			await expect(link).toHaveAccessibleName(new RegExp(name.split(' / ')[0]));
			await expect(link.locator('[title]')).toHaveAttribute('title', name);
			const geometry = await link.evaluate((el) => {
				const name = el.querySelector('.trip-stop-name')!;
				const time = el.querySelector('time')!;
				const nr = name.getBoundingClientRect(),
					tr = time.getBoundingClientRect();
				return {
					height: nr.height,
					lineHeight: parseFloat(getComputedStyle(name).lineHeight),
					nameTop: nr.top,
					nameBottom: nr.bottom,
					timeTop: tr.top,
					timeBottom: tr.bottom,
				};
			});
			expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 2 + 1);
			// The header is centred, so every wrapped line of its actions is too.
			const offCentre = await page.locator('.trip-head-actions').evaluate((row) => {
				const edge = row.getBoundingClientRect();
				const lines = new Map<number, DOMRect[]>();
				for (const child of row.children) {
					const box = child.getBoundingClientRect();
					if (box.width === 0) continue;
					const middle = Math.round((box.top + box.bottom) / 2);
					lines.set(middle, [...(lines.get(middle) ?? []), box]);
				}
				return [...lines.values()].map((boxes) =>
					Math.abs(
						Math.min(...boxes.map((b) => b.left)) -
							edge.left -
							(edge.right - Math.max(...boxes.map((b) => b.right))),
					),
				);
			});
			expect(offCentre.length).toBeGreaterThan(0);
			for (const gap of offCentre) expect(gap).toBeLessThanOrEqual(2);
			if (page.viewportSize()!.width >= 1280) {
				expect(geometry.timeTop).toBeLessThan(geometry.nameBottom);
				expect(geometry.timeBottom).toBeGreaterThan(geometry.nameTop);
			}
		});

for (const locale of ['en', 'fr'] as const)
	for (const provider of fixture('providers').providers)
		test(`${locale} ${provider.id} header provider stays readable @layout`, async ({ page }) => {
			await page.clock.setFixedTime(epoch + 30_000);
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			await page.route('**/v1/**', (route) =>
				forwardRoute(page, async () => {
					const url = new URL(route.request().url());
					url.pathname = `/__layout/fresh${url.pathname.replace('/octranspo/', '/stm/')}`;
					await route.fulfill({ response: await route.fetch({ url: url.href }) });
				}),
			);
			await page.goto(localizeHref(`/?provider=${provider.id}`, locale), {
				waitUntil: 'networkidle',
			});
			await page.evaluate(() => document.fonts.ready);
			const header = page.getByRole('banner');
			const { city, operator } = provider.labels[locale];
			const fullName = `${city} · ${operator}`;
			const picker = header.getByRole('combobox');
			const label = header.locator('.nav-provider-label:visible');
			await expect(picker).toHaveAccessibleName(new RegExp(fullName));
			await expect(picker).toHaveAttribute('title', fullName);
			await expect(picker.locator('option:checked')).toHaveText(fullName);
			const viewport = page.viewportSize()!;
			// Exercise both phone widths in each light/dark phone project.
			for (const width of viewport.width < 600 ? [360, 390] : [viewport.width]) {
				await page.setViewportSize({ ...viewport, width });
				await expect(label).toBeVisible();
				await expect(label).toHaveText(width < 600 ? operator : fullName);
				await expect
					.poll(() => label.evaluate((el) => el.scrollWidth - el.clientWidth))
					.toBeLessThanOrEqual(0);
			}
		});
