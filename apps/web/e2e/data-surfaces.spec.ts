import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { breadcrumbCopy } from '../src/lib/components/surface/breadcrumb.copy';
import { copy as healthCopy } from '../src/lib/features/health/health.copy';
import { stopReliabilityCopy } from '../src/lib/features/stops/reliability/stops-reliability.copy';
import { detailCopy } from '../src/lib/features/stops/stops.copy';
import { tripCopy } from '../src/lib/features/trips/trips.copy';
import { DEFAULT_LOCALE as locale, PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';
import { STATUS_LABELS } from '../src/lib/v1/enumLabels';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const departures = fixture('departures.json');
const stop = Object.keys(departures.stops)[0]!;
const trip = Object.keys(fixture('trips.json').trips)[0]!;
const grains = fixture('stop-reliability.json').periods.map(
	(period: { grain: string }) => period.grain,
);
// Inside the live data's 30 s freshness window.
const now = Date.parse(departures.generated_utc) + 30_000;

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.clock.setFixedTime(now);
});

// SurfaceRail is a pill and sheet below 1024px.
const railIsSheet = (page: Page) => page.viewportSize()!.width < 1024;

// Every element a CSS animation or transition starts on, recorded from page load.
const recordMotion = () => {
	const started: Element[] = [];
	Object.assign(window, { started });
	for (const type of ['animationstart', 'transitionrun'])
		addEventListener(type, (event) => started.push(event.target as Element), true);
};

const r = stopReliabilityCopy[locale];
const railPill = (page: Page) =>
	page.getByRole('button', { name: new RegExp(`^${r.controlsLabel}\\b`) });

// Server markup shows the pill before hydration wires it; retry the click until the sheet opens.
async function openRail(page: Page) {
	const sheet = page.getByRole('dialog', { name: r.controlsLabel, exact: true });
	await expect(async () => {
		if (!(await sheet.isVisible())) await railPill(page).click();
		await expect(sheet).toBeVisible({ timeout: 1_000 });
	}).toPass();
	return sheet;
}

test('a trip page names its breadcrumb trail and marks the current page', async ({ page }) => {
	await page.goto(`/trip/${trip}`);
	const trail = page.getByRole('navigation', { name: breadcrumbCopy[locale].label, exact: true });

	await expect(
		trail.getByRole('link', { name: tripCopy[locale].crumbHome, exact: true }),
	).toBeVisible();
	await expect(trail.locator('[aria-current="page"]')).toHaveText(tripCopy[locale].heading(trip));
});

test('status chips filter the departures and report their pressed state', async ({ page }) => {
	await page.goto(`/stop/${stop}`);
	const t = detailCopy[locale].next;
	const late = page
		.getByRole('group', { name: t.filter.statusLabel })
		.getByRole('button', { name: STATUS_LABELS[locale].late });
	const rows = page
		.getByRole('table', { name: t.table.caption })
		.getByRole('row')
		.filter({
			has: page.getByRole('rowheader'),
		});
	const lateCount = departures.stops[stop].filter(
		(d: { delay_min: number }) => d.delay_min > 0,
	).length;

	await expect(rows).toHaveCount(departures.stops[stop].length);
	// Server markup shows the chips before hydration wires them; retry until one responds.
	await expect(async () => {
		if ((await late.getAttribute('aria-pressed')) !== 'true') await late.click();
		await expect(late).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 });
	}).toPass();
	await expect(rows).toHaveCount(lateCount);
	await late.click();
	await expect(late).toHaveAttribute('aria-pressed', 'false');
	await expect(rows).toHaveCount(departures.stops[stop].length);
});

test('the roll-up period is a radio group the arrow keys move through', async ({ page }) => {
	await page.goto(`/stop/${stop}?tab=reliability`);
	if (railIsSheet(page)) await openRail(page);
	const group = page.getByRole('radiogroup', { name: r.grain.label }).first();
	const checked = group.getByRole('radio', { checked: true });

	// One enabled choice per grain the fixture publishes; the others stay listed but disabled.
	await expect(group.getByRole('radio', { disabled: false })).toHaveCount(grains.length);
	const before = (await checked.textContent())!;
	// Server markup shows the choices before hydration wires them; retry until the keys respond.
	await expect(async () => {
		if ((await checked.textContent()) === before) {
			await checked.focus();
			await page.keyboard.press('ArrowRight');
		}
		await expect(checked).not.toHaveText(before, { timeout: 1_000 });
	}).toPass();
	await expect(checked).toBeFocused();
});

for (const lang of PUBLISHED_LOCALES) {
	test(`${lang}: the stop tabs keep the open tab in the URL without adding history`, async ({
		page,
	}) => {
		await page.goto(localizeHref(`/stop/${stop}`, lang));
		const entries = await page.evaluate(() => history.length);
		// Detail last, so the loop ends where the page started.
		for (const [key, name] of Object.entries(detailCopy[lang].tabs).reverse()) {
			const tab = page.getByRole('tab', { name, exact: true });
			// Server markup shows the tabs before hydration wires them; retry until one responds.
			await expect(async () => {
				if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
				await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
			}).toPass();
			await expect(page).toHaveURL(
				(url) => url.searchParams.get('tab') === (key === 'detail' ? null : key),
			);
			expect(await page.evaluate(() => history.length)).toBe(entries);
			if (key === 'detail') continue;
			await page.reload();
			await expect(tab).toHaveAttribute('aria-selected', 'true');
		}
	});
}

test('on desktop the stop tabs sit centred in their toolbar', async ({ page }, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'the tab list fills the toolbar below desktop widths',
	);
	await page.goto(`/stop/${stop}`);
	// The toolbar is the tab list's first wider ancestor.
	const [list, bar] = await page.getByRole('tablist').evaluate((element) => {
		let bar = element.parentElement!;
		while (bar.getBoundingClientRect().width <= element.getBoundingClientRect().width + 1)
			bar = bar.parentElement!;
		return [element, bar].map((node) => node.getBoundingClientRect().toJSON());
	});
	expect(list.width).toBeLessThan(bar.width);
	expect(Math.abs(list.x + list.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(1);
});

test('below 1024px the view rail opens as a dialog and Escape returns to its pill', async ({
	page,
}) => {
	test.skip(!railIsSheet(page), 'the rail is a sheet only below 1024px');
	await page.addInitScript(recordMotion);
	await page.goto(`/stop/${stop}?tab=reliability`);
	const sheet = await openRail(page);
	// Reduced motion (the suite's default): nothing on the sheet animated in; the click ripple is not part of it.
	expect(
		await sheet.evaluate((surface) =>
			(window as unknown as { started: Element[] }).started
				.filter((target) => target.contains(surface) || surface.contains(target))
				.map((target) => target.getAttribute('class')),
		),
	).toEqual([]);

	await expect(sheet.getByRole('radiogroup', { name: r.grain.label })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(railPill(page)).toBeFocused();
});

test('the status page stacks its coverage table on phones and says when data is missing', async ({
	page,
}) => {
	await page.goto('/status');
	const table = page.getByRole('table', {
		name: healthCopy[locale].historyCoverage.tableLabel,
		exact: true,
	});

	await expect(table.getByRole('rowheader').first()).toBeVisible();
	expect(await table.getByRole('rowheader').count()).toBeGreaterThan(1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	const box = (await table.boundingBox())!;
	expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	await expect(page.getByRole('main').getByRole('status').first()).toBeVisible();
});

test('axe finds no serious issues on the data surfaces', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'axe results do not depend on the viewport');
	for (const path of [`/trip/${trip}`, `/stop/${stop}`, '/status']) {
		await page.goto(path);
		const { violations } = await new AxeBuilder({ page }).analyze();
		expect(
			violations
				.filter(({ impact }) => impact === 'serious' || impact === 'critical')
				.map(({ id }) => `${path}: ${id}`),
		).toEqual([]);
	}
});
