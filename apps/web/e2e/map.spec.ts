import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { SURFACE_NAV } from '../src/lib/content/nav';
import { copy as mapCopy } from '../src/lib/features/map/map.copy';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stop = fixture('stops-index.json').stops[0];
const map = SURFACE_NAV.find((item) => item.key === 'map')!.href;
// The banner reads the oldest live family; the map always loads alerts.
const generated = Date.parse(fixture('alerts.json').generated_utc);
const address = {
	lat: stop.lat,
	lon: stop.lon,
	label: 'Fixture address',
	source: 'geo_ca',
	precision: 'address',
};

// Every element a CSS animation or transition starts on, recorded from page load.
const recordMotion = () => {
	const started: Element[] = [];
	Object.assign(window, { started });
	for (const type of ['animationstart', 'transitionrun'])
		addEventListener(type, (event) => started.push(event.target as Element), true);
};

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.route('**/api/geocode**', (route) => route.fulfill({ json: { results: [address] } }));
});

// Server markup shows the toggle before hydration wires it; retry until the panel opens.
async function openNearMe(page: Page, name: string) {
	const toggle = page.getByRole('button', { name, exact: true });
	await expect(async () => {
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
	}).toPass();
}

test('manual refresh stays busy until live data is received and rendered', async ({ page }) => {
	await page.clock.install({ time: generated + 15_000 });
	let hold = false;
	let release!: () => void;
	let markHeld!: () => void;
	const responseGate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const held = new Promise<void>((resolve) => {
		markHeld = resolve;
	});
	const newerTimestamp = new Date(generated + 5000).toISOString();
	await page.route('**/live/vehicles.json', async (route) => {
		if (hold) {
			markHeld();
			await responseGate;
		}
		await route.fulfill({
			json: {
				generated_utc: hold ? newerTimestamp : new Date(generated).toISOString(),
				vehicles: [],
			},
		});
	});
	await page.goto('/map');
	const placement = page.viewportSize()!.width < 1024 ? 'head' : 'floating';
	const timestamp = page.locator(`.map-freshness[data-placement="${placement}"] time`);
	await expect(timestamp).toHaveAttribute('datetime', new Date(generated).toISOString());
	hold = true;
	const invalidated = page.waitForResponse((response) => response.url().includes('__data.json'));
	try {
		await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
		await held;
		await (await invalidated).finished();
		await page.clock.runFor(250);
		await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeDisabled();
		release();
		await expect(page.getByRole('button', { name: 'Refresh data', exact: true })).toBeEnabled();
		await expect(timestamp).toHaveAttribute('datetime', newerTimestamp);
	} finally {
		release();
	}
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
	test(`report age advances each second while idle (${reducedMotion})`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion });
		await page.clock.install({ time: generated + 15_000 });
		await page.route('**/live/vehicles.json', (route) =>
			route.fulfill({
				json: {
					generated_utc: new Date(generated).toISOString(),
					vehicles: [],
				},
			}),
		);
		await page.goto('/map', { waitUntil: 'networkidle' });
		const placement = page.viewportSize()!.width < 1024 ? 'head' : 'floating';
		const stamp = page.locator(
			`.map-freshness[data-placement="${placement}"] [data-slot="freshness-stamp"]`,
		);
		await expect(stamp).toHaveAttribute('data-age-seconds', /^\d+$/);
		const age = Number(await stamp.getAttribute('data-age-seconds'));
		await page.clock.runFor(2100);
		await expect
			.poll(async () => Number(await stamp.getAttribute('data-age-seconds')))
			.toBeGreaterThanOrEqual(age + 2);
	});

	test(`manual refresh does not make an unchanged report younger (${reducedMotion})`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion });
		const cachedDate = new Date(generated + 15_000).toUTCString();
		const clockHeaders = {
			date: cachedDate,
			age: '0',
			'access-control-allow-origin': '*',
			'access-control-expose-headers': 'Date, Age',
		};
		await page.clock.install({ time: generated + 15_000 });
		await page.route('**/v1/**', async (route) => {
			if (new URL(route.request().url()).pathname.endsWith('/live/vehicles.json')) {
				await route.fulfill({
					json: { generated_utc: new Date(generated).toISOString(), vehicles: [] },
					headers: clockHeaders,
				});
				return;
			}
			const response = await route.fetch();
			await route.fulfill({
				response,
				headers: { ...response.headers(), ...clockHeaders },
			});
		});
		await page.goto('/map');
		const placement = page.viewportSize()!.width < 1024 ? 'head' : 'floating';
		const stamp = page.locator(
			`.map-freshness[data-placement="${placement}"] [data-slot="freshness-stamp"]`,
		);
		await expect(stamp).toHaveAttribute('data-age-seconds', /^\d+$/);
		const originalAge = Number(await stamp.getAttribute('data-age-seconds'));
		const timestamp = await stamp.locator('time').getAttribute('datetime');
		for (let click = 1; click <= 3; click += 1) {
			await page.clock.runFor(1100);
			const refreshed = page.waitForResponse((response) =>
				new URL(response.url()).pathname.endsWith('/live/vehicles.json'),
			);
			await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
			await refreshed;
			await expect(page.getByRole('button', { name: 'Refresh data', exact: true })).toBeEnabled();
			await expect
				.poll(async () => Number(await stamp.getAttribute('data-age-seconds')))
				.toBeGreaterThanOrEqual(originalAge + click);
			await expect(stamp.locator('time')).toHaveAttribute('datetime', timestamp!);
		}
	});
}

for (const locale of PUBLISHED_LOCALES) {
	const t = mapCopy[locale];
	// The stall message at any age.
	const stall = new RegExp(literal(t.feedNotResponding('\0')).replace('\0', '.+'));

	test(`${locale}: an address lists the stop beside it, which opens its details without motion`, async ({
		page,
	}) => {
		await page.addInitScript(recordMotion);
		await page.goto(localizeHref(map, locale));
		await openNearMe(page, t.nearMe);
		await page.getByRole('searchbox', { name: t.nearMeSearchPlaceholder }).fill(address.label);
		const suggestion = page
			.getByRole('group', { name: t.nearMeSuggestions })
			.getByRole('button', { name: new RegExp(literal(address.label)) });
		await expect(suggestion).toBeVisible();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: t.nearMeSearchSubmit })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(suggestion).toBeFocused();
		await page.keyboard.press('Enter');
		await page.getByRole('button', { name: new RegExp(`^${literal(stop.name)}`) }).click();

		// A side panel on desktop, a sheet below.
		const detail = page
			.getByRole('complementary', { name: stop.name })
			.or(page.getByRole('dialog', { name: stop.name }));
		await expect(detail).toBeVisible();
		// Reduced motion (the suite's default): nothing on the surface animated in. The click
		// ripple stays on by design (@yesid/motion globalRipple) and is not part of the surface.
		expect(
			await detail.evaluate((surface) =>
				(window as unknown as { started: Element[] }).started
					.filter((target) => target.contains(surface) || surface.contains(target))
					.map((target) => target.getAttribute('class')),
			),
		).toEqual([]);
	});

	test(`${locale}: a stalled feed says so while the map controls stay apart and usable`, async ({
		page,
	}) => {
		await page.clock.install({ time: generated });
		// Exercise a known-age stall for both active families. The shared fixture server
		// intentionally has no vehicle snapshot, which is an unknown-age failure instead.
		await page.route('**/live/vehicles.json', (route) =>
			route.fulfill({ json: { generated_utc: new Date(generated).toISOString(), vehicles: [] } }),
		);
		const alerts = page.waitForResponse((response) =>
			new URL(response.url()).pathname.endsWith('/live/alerts.json'),
		);
		await page.goto(localizeHref(map, locale));
		await alerts;
		const banner = page.getByRole('status').filter({ hasText: stall });
		const nearMe = page.getByRole('button', { name: t.nearMe, exact: true });
		await expect(nearMe).toBeVisible();
		await expect(page.getByRole('status').filter({ hasText: t.liveNoVehicles })).toBeVisible();
		await expect(banner).toHaveCount(0);
		// Well past the stale threshold of three live TTLs.
		await page.clock.fastForward('05:00');
		await expect(banner).toBeVisible();

		const attribution = page.getByLabel(t.attributionToggle, { exact: true }).locator('..');
		const boxes = await Promise.all(
			[banner, nearMe, attribution, page.locator('[data-slot="map-north"]')].map(
				async (control) => (await control.boundingBox())!,
			),
		);
		const viewport = page.viewportSize()!;
		for (const [i, a] of boxes.entries()) {
			expect(a.x >= 0 && a.y >= 0, `control ${i} starts inside the viewport`).toBe(true);
			expect(a.x + a.width <= viewport.width && a.y + a.height <= viewport.height).toBe(true);
			for (const b of boxes.slice(i + 1)) {
				const overlap =
					a.x < b.x + b.width &&
					b.x < a.x + a.width &&
					a.y < b.y + b.height &&
					b.y < a.y + a.height;
				expect(overlap, `control ${i} overlaps a later one`).toBe(false);
			}
		}
		await openNearMe(page, t.nearMe);
	});
}
