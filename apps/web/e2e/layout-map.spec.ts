import { test } from './layout-test';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
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
		const width = page.viewportSize()!.width;
		const defect =
			width === 360 || width === 390 || width === 844
				? 'LAYOUT-ISLAND: initial camera cuts off provider fit bounds on phones'
				: provider.id === 'octranspo' && width === 1920
					? 'LAYOUT-OTTAWA-CHROME: provider fit bounds intersect desktop map chrome'
					: null;
		if (defect) {
			info.annotations.push({ type: 'defect', description: defect });
			test.fail(true, defect);
		}
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
	await page.route('**/v1/**', async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith('/live/vehicles.json')) vehiclePolls++;
		url.pathname = `/__layout/fresh${url.pathname}`;
		const response = await route.fetch({ url: url.href });
		if (url.pathname.endsWith('/live/vehicles.json')) {
			const body = await response.json();
			// S1 lies behind the eastbound vehicle. This case tests between-report
			// motion without a known next stop; stop capping has its own unit tests.
			for (const vehicle of body.vehicles) vehicle.next_stop = null;
			await route.fulfill({ response, json: body });
		} else await route.fulfill({ response });
	});
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
