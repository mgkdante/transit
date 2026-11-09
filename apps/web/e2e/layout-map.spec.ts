import { test } from './layout-test';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { forwardRoute } from './layout-helpers';
const read = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
const epoch = Date.parse(read('departures').generated_utc);
type Probe = {
	project(c: [number, number]): { x: number; y: number };
	moving: boolean;
	loaded: boolean;
};
type Draw = { x: number; y: number; time: number; cameraMoving: boolean };
async function framing(page: Page, bounds: number[]) {
	return page.evaluate((bounds) => {
		const probe = (window as unknown as { __transitMap: Probe }).__transitMap;
		const map = document.querySelector('[data-slot="map-stage"]')!.getBoundingClientRect();
		const blockers = [
			...document.querySelectorAll(
				'header,.map-head,.map-filter-panel,.map-near,.map-filter-pill-container,[data-slot="map-detail-overlay"],[data-slot="right-panel"],.maplibregl-ctrl',
			),
		]
			.filter((el) => el.checkVisibility())
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 1 && r.height > 1);
		const [w, s, e, n] = bounds;
		const points = [
			[w, s],
			[w, n],
			[e, s],
			[e, n],
		]
			.map((c) => probe.project(c as [number, number]))
			.map((p) => ({ x: p.x + map.x, y: p.y + map.y }));
		const island = {
			left: Math.min(...points.map((p) => p.x)),
			right: Math.max(...points.map((p) => p.x)),
			top: Math.min(...points.map((p) => p.y)),
			bottom: Math.max(...points.map((p) => p.y)),
		};
		return {
			outside: points.some(
				(p) =>
					p.x < map.left - 1 || p.x > map.right + 1 || p.y < map.top - 1 || p.y > map.bottom + 1,
			),
			covered: blockers
				.filter(
					(r) =>
						Math.min(r.right, island.right) - Math.max(r.left, island.left) > 1 &&
						Math.min(r.bottom, island.bottom) - Math.max(r.top, island.top) > 1,
				)
				.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
			island,
		};
	}, bounds);
}
for (const provider of read('providers').providers)
	test(`${provider.id} island framing after load and settle @layout`, async ({ page }, info) => {
		await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
		await page.clock.setFixedTime(epoch + 30_000);
		await page.goto(`/map?provider=${provider.id}`, { waitUntil: 'networkidle' });
		await expect
			.poll(() =>
				page.evaluate(() =>
					Boolean((window as unknown as { __transitMap?: Probe }).__transitMap?.loaded),
				),
			)
			.toBe(true);
		const loaded = await framing(page, provider.fit_bounds);
		await expect
			.poll(() =>
				page.evaluate(() => (window as unknown as { __transitMap: Probe }).__transitMap.moving),
			)
			.toBe(false);
		const settled = await framing(page, provider.fit_bounds);
		await info.attach('map-framing', {
			body: JSON.stringify({ loaded, settled }),
			contentType: 'application/json',
		});
		expect(loaded.outside || loaded.covered.length > 0).toBe(false);
		expect(settled.outside || settled.covered.length > 0).toBe(false);
	});
test('estimated vehicle draws move before the next feed poll @layout', async ({ page }, info) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.clock.setSystemTime(epoch + 1000);
	await page.addInitScript(() => {
		localStorage.setItem('transit:motion-mode', 'smooth');
		const draws: Draw[] = [];
		Object.assign(window, { layoutDraws: draws });
		let first = true;
		const clear = CanvasRenderingContext2D.prototype.clearRect;
		CanvasRenderingContext2D.prototype.clearRect = function (...args) {
			first = true;
			return Reflect.apply(clear, this, args);
		};
		const draw = CanvasRenderingContext2D.prototype.drawImage;
		CanvasRenderingContext2D.prototype.drawImage = function (
			...args: [CanvasImageSource, number, number, ...number[]]
		) {
			if (this.canvas.dataset.slot === 'vehicle-overlay' && first) {
				first = false;
				draws.push({
					x: Number(args[1]),
					y: Number(args[2]),
					time: performance.now(),
					cameraMoving:
						(window as unknown as { __transitMap?: Probe }).__transitMap?.moving ?? true,
				});
				if (draws.length > 2000) draws.shift();
			}
			return Reflect.apply(draw, this, args);
		};
	});
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	let vehiclePolls = 0;
	await page.route('**/v1/**', (route) =>
		forwardRoute(async () => {
			const url = new URL(route.request().url());
			if (url.pathname.endsWith('/live/vehicles.json')) vehiclePolls++;
			url.pathname = `/__layout/fresh${url.pathname}`;
			const response = await route.fetch({ url: url.href });
			if (url.pathname.endsWith('/live/vehicles.json')) {
				const body = await response.json();
				// S1 lies behind the eastbound vehicle. This case tests between-report
				// motion without a known next stop; stop capping has its own unit tests.
				for (const vehicle of body.vehicles) {
					vehicle.next_stop = null;
					vehicle.next_stop_lat = null;
					vehicle.next_stop_lon = null;
				}
				await route.fulfill({ response, json: body });
			} else await route.fulfill({ response });
		}),
	);
	await page.goto('/map', { waitUntil: 'networkidle' });
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean((window as unknown as { __transitMap?: Probe }).__transitMap?.loaded),
			),
		)
		.toBe(true);
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as { __transitMap: Probe }).__transitMap.moving),
		)
		.toBe(false);
	await page.evaluate(() => {
		(window as unknown as { layoutDraws: unknown[] }).layoutDraws.length = 0;
	});
	const pollsBeforeSample = vehiclePolls;
	expect(pollsBeforeSample, 'one fresh vehicle response loaded').toBe(1);
	let samples: Draw[] = [];
	await expect
		.poll(
			async () => {
				samples = await page.evaluate(
					() => (window as unknown as { layoutDraws: Draw[] }).layoutDraws,
				);
				return (
					samples.length > 1 &&
					Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x)) > 0.01
				);
			},
			{ message: 'vehicle moves between settled camera frames', timeout: 5000 },
		)
		.toBe(true);
	expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
		false,
	);
	expect(
		await page.evaluate(() => Date.now()),
		'sample remains within the fresh feed TTL',
	).toBeLessThan(epoch + 60_000);
	expect(
		await page.evaluate(() => (window as unknown as { __transitMap: Probe }).__transitMap.moving),
	).toBe(false);
	await info.attach('drawn-positions', {
		body: JSON.stringify(samples),
		contentType: 'application/json',
	});
	expect(vehiclePolls, 'both frames belong to the same feed poll').toBe(pollsBeforeSample);
	expect(samples.length).toBeGreaterThan(1);
	expect(
		samples.every((sample) => !sample.cameraMoving),
		'camera stayed settled during sampling',
	).toBe(true);
	expect(samples.at(-1)!.time).toBeGreaterThan(samples[0].time);
	expect(
		Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x)),
	).toBeGreaterThan(0.01);
});

// iPhone home-indicator inset. Chromium and WebKit report env(safe-area-inset-bottom) as 0
// here, so the check reserves the worst case explicitly.
const HOME_INDICATOR_PX = 34;
test('mobile detail sheet keeps its header controls above the home indicator at peek @layout', async ({
	page,
}, info) => {
	test.skip(page.viewportSize()!.width >= 1024, 'desktop shows the detail panel, not the sheet');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.clock.setFixedTime(epoch + 30_000);
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.route('**/v1/**', (route) =>
		forwardRoute(async () => {
			const url = new URL(route.request().url());
			url.pathname = `/__layout/fresh${url.pathname}`;
			await route.fulfill({ response: await route.fetch({ url: url.href }) });
		}),
	);
	await page.goto('/map?vehicle=layout-bus', { waitUntil: 'networkidle' });
	const canvas = page.locator('[data-slot="vehicle-overlay"]');
	await expect
		.poll(() =>
			canvas.evaluate(
				(el) =>
					Reflect.get(el, Symbol.for('transit.map.vehicleOverlayReceipt'))?.paintedBodyCount ?? 0,
			),
		)
		.toBeGreaterThan(0);
	const point = await page.evaluate(() =>
		(window as unknown as { __transitMap: Probe }).__transitMap.project([-73.59, 45.51]),
	);
	await page.locator('.maplibregl-canvas').click({ position: point });
	const sheet = page.locator('[data-slot="bottom-sheet"]');
	await expect(sheet).toBeVisible();
	// The handle can take a key before the opening sheet settles; retry until peek is reached.
	await expect(async () => {
		await page.locator('[data-sheet-handle]').press('Home');
		await expect(sheet).toHaveAttribute('data-detent', 'peek', { timeout: 1000 });
	}).toPass();

	const clearance = () =>
		page.evaluate((inset) => {
			const limit = innerHeight - inset;
			const controls = [
				...document.querySelectorAll<HTMLElement>(
					'[data-slot="bottom-sheet"] [data-sheet-handle], [data-slot="bottom-sheet"] button[data-slot^="bottom-sheet-"]',
				),
			].filter((el) => el.checkVisibility());
			return {
				limit,
				controls: controls.map((el) => ({
					name: el.getAttribute('aria-label') ?? el.dataset.slot ?? el.tagName,
					bottom: el.getBoundingClientRect().bottom,
				})),
			};
		}, HOME_INDICATOR_PX);

	const single = await clearance();
	// Force a two-line identity, the tallest header the sheet budgets for at peek.
	await page.locator('[data-slot="bottom-sheet"] [data-slot="sheet-title"]').evaluate((title) => {
		title.textContent = 'Route 747 YUL Aéroport–Centre-ville';
	});
	const wrapped = await clearance();
	await info.attach('sheet-peek-clearance', {
		body: JSON.stringify({ single, wrapped }),
		contentType: 'application/json',
	});
	for (const sample of [single, wrapped]) {
		expect(sample.controls.length, 'handle and close are measured').toBeGreaterThanOrEqual(2);
		for (const control of sample.controls)
			expect(control.bottom, `${control.name} clears the home indicator`).toBeLessThanOrEqual(
				sample.limit,
			);
	}
});

for (const provider of read('providers').providers) {
	for (const locale of ['en', 'fr']) {
		test(`${provider.id} ${locale} map title without eyebrow @layout`, async ({ page }) => {
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			await page.clock.setFixedTime(epoch + 30_000);
			await page.goto(`${locale === 'fr' ? '/fr' : ''}/map?provider=${provider.id}`, {
				waitUntil: 'networkidle',
			});
			const heading = page.getByRole('heading', { level: 1 });
			await expect(heading).toBeVisible();
			await expect(page.getByText(/NETWORK · LIVE|RÉSEAU · EN DIRECT/)).toHaveCount(0);
			const geometry = await heading.evaluate((el) => {
				const title = el.getBoundingClientRect();
				const head = el.closest('.map-head')!.getBoundingClientRect();
				return {
					top: title.top - head.top,
					left: title.left - head.left,
					right: title.right,
					width: innerWidth,
				};
			});
			expect(geometry.top).toBeGreaterThanOrEqual(0);
			expect(geometry.top).toBeLessThan(8);
			expect(geometry.left).toBeGreaterThanOrEqual(0);
			expect(geometry.left).toBeLessThan(12);
			expect(geometry.right).toBeLessThanOrEqual(geometry.width);
		});
	}
}
