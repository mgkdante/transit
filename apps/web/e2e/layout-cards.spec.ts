import closedWindows from '../scripts/__fixtures__/b9/layout-windows.json' with { type: 'json' };
import { test } from './layout-test';
import { expect, type Page, type Request as PlaywrightRequest } from '@playwright/test';
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
						Object.assign(body, closedWindows.ready.line);
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

function brokenStatusWords(element: Element) {
	const status = element.querySelector('[data-slot="entity-result-status"]');
	if (!status) return [];
	const words: string[] = [];
	const bounds = element.getBoundingClientRect();
	const walker = document.createTreeWalker(status, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		for (const match of node.textContent!.matchAll(/\S+/g)) {
			const range = document.createRange();
			range.setStart(node, match.index!);
			range.setEnd(node, match.index! + match[0].length);
			if (
				new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1 ||
				[...range.getClientRects()].some((r) => r.left < bounds.left || r.right > bounds.right + 1)
			)
				words.push(match[0]);
		}
	}
	return words;
}
async function holdReliability(page: Page, path: string) {
	const entityFile =
		path === '/lines' ? '/route_reliability/24.json' : '/stop_reliability/52095.json';
	const gate = {
		holding: true,
		state: 'ready',
		entered: (_request: PlaywrightRequest) => {},
		releases: [] as Array<() => void>,
	};
	await page.route('**/v1/**', async (route) => {
		const entered = gate.entered;
		const state = gate.state;
		const url = new URL(route.request().url());
		url.pathname = '/__layout/fresh' + url.pathname;
		const response = await route.fetch({ url: url.href });
		if (url.pathname.endsWith('/historic' + entityFile)) {
			entered(route.request());
			if (gate.holding)
				await new Promise<void>((resolve) => {
					gate.releases.push(resolve);
				});
			if (state === 'empty') {
				await route.fulfill({
					status: 404,
					json: {},
					headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
				});
				return;
			}
			const body = await response.json();
			Object.assign(
				body,
				closedWindows[
					state === 'low-sample' ? 'low-sample' : state === 'hedge' ? 'hedge' : 'ready'
				][path === '/lines' ? 'line' : 'stop'],
			);
			await route.fulfill({ response, json: body });
		} else await route.fulfill({ response });
	});
	return gate;
}
for (const locale of ['en', 'fr'] as const)
	for (const path of ['/lines', '/stops'])
		for (const width of [320, 360, 390])
			test(`${locale} ${path} ${width} reliability arrival keeps row height and whole words`, async ({
				page,
			}) => {
				const gate = await holdReliability(page, path);
				await page.addInitScript(() => {
					const state = window as typeof window & {
						__transitReliabilityTestSettledFetches: string[];
					};
					state.__transitReliabilityTestSettledFetches = [];
					const nativeFetch = window.fetch;
					window.fetch = async (...args) => {
						try {
							return await nativeFetch(...args);
						} finally {
							const input = args[0];
							state.__transitReliabilityTestSettledFetches.push(
								typeof input === 'string'
									? input
									: input instanceof Request
										? input.url
										: String(input),
							);
						}
					};
				});
				try {
					await page.setViewportSize({ width, height: 900 });
					let readyHeight: number | undefined;
					for (const state of ['ready', 'hedge', 'low-sample', 'empty']) {
						gate.state = state;
						gate.holding = true;
						const pending = new Promise<PlaywrightRequest>((resolve) => {
							gate.entered = resolve;
						});
						await page.goto(
							localizeHref(
								path === '/stops' ? '/stops?provider=stm&route=24' : '/lines?provider=stm',
								locale,
							),
							{ waitUntil: 'domcontentloaded' },
						);
						const entityPath = localizeHref(
							path === '/lines' ? '/lines/24' : '/stop/52095',
							locale,
						);
						const row = page
							.locator('[data-slot="entity-result-row"]')
							.filter({ has: page.locator(`a[href^="${entityPath}?"]`) })
							.first();
						await row.scrollIntoViewIfNeeded();
						const request = await pending;
						const delivered = page.waitForResponse((response) => response.request() === request);
						await page.evaluate(() => document.fonts.ready);
						const before = (await row.boundingBox())!.height;
						gate.holding = false;
						for (const release of gate.releases.splice(0)) release();
						const response = await delivered;
						if (state !== 'empty') await response.finished();
						expect(response.status()).toBe(state === 'empty' ? 404 : 200);
						if (state === 'empty') {
							await page.waitForFunction(
								(file) =>
									(
										window as typeof window & { __transitReliabilityTestSettledFetches: string[] }
									).__transitReliabilityTestSettledFetches.some((url) => url.includes(file)),
								path === '/lines' ? '/route_reliability/24.json' : '/stop_reliability/52095.json',
							);
							await expect(row.locator('[data-slot="entity-result-status"]')).toHaveCount(0);
						} else
							await expect(
								row.locator(
									state === 'hedge' || state === 'low-sample'
										? '[data-slot="reliability-hedge"]'
										: '[data-slot="reliability-badge"]',
								),
							).toBeVisible();
						if (state === 'low-sample')
							await expect(row.locator('[data-slot="reliability-hedge"]')).toContainText(
								locale === 'fr' ? /Données insuffisantes/ : /Not enough data/,
							);
						const after = (await row.boundingBox())!.height;
						expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
						if (state === 'ready') readyHeight = after;
						expect(after).toBeLessThanOrEqual(readyHeight! + 1);
						expect(await row.evaluate(brokenStatusWords)).toEqual([]);
					}
				} finally {
					gate.holding = false;
					for (const release of gate.releases.splice(0)) release();
				}
			});
