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
		await page.getByRole('combobox', { name: t.nearMeSearchPlaceholder }).fill(address.label);
		await page.getByRole('option', { name: new RegExp(literal(address.label)) }).click();
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
		const alerts = page.waitForResponse((response) =>
			new URL(response.url()).pathname.endsWith('/live/alerts.json'),
		);
		await page.goto(localizeHref(map, locale));
		await alerts;
		const banner = page.getByRole('status').filter({ hasText: stall });
		const nearMe = page.getByRole('button', { name: t.nearMe, exact: true });
		await expect(nearMe).toBeVisible();
		await expect(banner).toHaveCount(0);
		// Well past the stale threshold of three live TTLs.
		await page.clock.fastForward('05:00');
		await expect(banner).toBeVisible();

		const attribution = page.getByLabel(t.attributionToggle, { exact: true }).locator('..');
		const boxes = await Promise.all(
			[banner, nearMe, attribution].map(async (control) => (await control.boundingBox())!),
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
