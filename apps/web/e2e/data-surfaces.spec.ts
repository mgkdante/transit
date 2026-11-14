import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { copy as healthCopy } from '../src/lib/features/health/health.copy';
import { stopReliabilityCopy } from '../src/lib/features/stops/reliability/stops-reliability.copy';
import { detailCopy } from '../src/lib/features/stops/stops.copy';
import { createLineDirectory } from '../src/lib/site/lineDirectory';
import { routeNameFallback } from '../src/lib/site/nameFallback';
import { tripCopy } from '../src/lib/features/trips/trips.copy';
import { DEFAULT_LOCALE as locale, PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';
import { STATUS_LABELS } from '../src/lib/v1/enumLabels';
import { stampCopy } from '../src/lib/v1/stamp.copy';
import { intl } from '../src/lib/i18n/copy';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const departures = fixture('departures.json');
const stop = Object.keys(departures.stops)[0]!;
const trips = fixture('trips.json').trips;
const grains = fixture('stop-reliability.json').periods.map(
	(period: { grain: string }) => period.grain,
);
// Inside the live data's 30 s freshness window.
const now = Date.parse(departures.generated_utc) + 30_000;

for (const lang of PUBLISHED_LOCALES)
	test(`${lang}: record pages show only the record stamp form`, async ({ page }) => {
		const manifest = fixture('manifest.json');
		const bundle = fixture('../scripts/__fixtures__/b9/rich.json').files;
		const day = bundle['historic/receipts/index.json'].dates.at(-1);
		// The core server synthesizes the receipt with its live fixture's publication date.
		const records = [
			['hotspots', fixture('hotspots.json').generated_utc, null],
			['repeat-offenders', fixture('repeat-offenders.json').generated_utc, null],
			['alerts', fixture('alerts.json').generated_utc, null],
			['receipt', manifest.files.live.generated_utc, day],
			['metrics', fixture('provenance.json').generated_utc, null],
		];
		// Supply the empty alerts fixture at the record endpoint absent from the core server.
		await page.route('**/historic/alert_history.json', (route) =>
			route.fulfill({ json: fixture('alerts.json') }),
		);
		const date = (key: string) =>
			intl
				.dateTime(lang, {
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC',
					...(!manifest.tz ? { year: 'numeric' as const } : {}),
				})
				.format(new Date(key));
		for (const [path, generated, day] of records) {
			const published = generated.slice(0, 10);
			const expected = stampCopy[lang].record(
				day ? date(day) : null,
				date(published),
				day ? 'day' : 'window',
			);
			await page.goto(localizeHref(`/${path}`, lang, manifest.provider));
			const header = page.locator('[data-slot="article-header"]');
			await expect(header.locator('time')).toHaveText(expected);
			await expect(header.locator('time')).toHaveAttribute('datetime', published);
			await expect(page.locator('[data-slot="article-keywords"]')).toHaveCount(0);
			await expect(page.locator('[data-slot="stat-freshness"]')).toHaveCount(0);
		}
	});

for (const lang of PUBLISHED_LOCALES)
	test(lang + ': live pages show only the live and record stamp forms', async ({ page }) => {
		const manifest = fixture('manifest.json');
		const line = fixture('routes-index.json').routes[0].id;
		const trip = Object.keys(trips)[0];
		const stopName = fixture('stops-index.json').stops[0].name;
		const patterns = (['data', 'alerts'] as const).flatMap((subject) =>
			(['current', 'behind', 'unknown', 'not-responding'] as const).map((state) =>
				stampCopy[lang].live(subject, state, '\0').split('\0').join('.+'),
			),
		);
		const pattern = new RegExp('^(?:' + patterns.join('|') + ')$');
		let liveCount = 0;
		for (const path of [
			'/',
			'/map',
			'/network',
			'/lines/' + line + '?tab=detail',
			'/stop/' + stop + '?tab=detail',
			'/trip/' + trip,
			'/search?q=' + encodeURIComponent(stopName),
		]) {
			await page.goto(localizeHref(path, lang, manifest.provider));
			await page.waitForLoadState('networkidle');
			const stamps = page.locator('[data-slot="freshness-stamp"]');
			for (const stamp of await stamps.all()) {
				await expect(stamp).toHaveAttribute('data-form', /^(live|record)$/);
				if ((await stamp.getAttribute('data-form')) === 'live') {
					await expect(stamp.locator('time')).not.toHaveCSS('white-space', 'nowrap');
					await expect(stamp.locator('time')).toHaveText(pattern);
					liveCount++;
				}
			}
			if (path === '/network') await expect(page.locator('[data-slot="feed-age"]')).toHaveCount(0);
			if (path === '/network' || path.startsWith('/trip/'))
				await expect(page.locator('[data-slot="article-keywords"]')).toHaveCount(0);
		}
		expect(liveCount).toBeGreaterThan(0);
	});

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

test('a trip page shows one heading without breadcrumbs', async ({ page }) => {
	const provider = fixture('manifest.json').provider;
	for (const lang of PUBLISHED_LOCALES) {
		const directory = createLineDirectory(fixture('routes-index.json').routes, {
			line: (id) => routeNameFallback(id, lang),
		});
		for (const id of [Object.keys(trips)[0], 'TLine']) {
			const route = trips[id].route;
			const heading = directory.spoken(directory.number(route));
			await page.goto(localizeHref('/trip/' + id, lang, provider));
			await expect(page.getByRole('navigation', { name: /Breadcrumb|Fil d/ })).toHaveCount(0);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
			await expect(
				page.getByRole('link', { name: tripCopy[lang].backLine(heading), exact: true }),
			).toHaveAttribute('href', localizeHref('/lines/' + route, lang, provider));
			await expect(page).toHaveTitle(heading + ' · Transit');
		}
	}
});

test('status chips filter the departures and report their pressed state', async ({ page }) => {
	await page.goto(`/stop/${stop}?tab=detail`);
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
		// The record last, so the loop ends where the bare URL started.
		for (const [key, name] of Object.entries(detailCopy[lang].tabs).reverse()) {
			const tab = page.getByRole('tab', { name, exact: true });
			// Server markup shows the tabs before hydration wires them; retry until one responds.
			await expect(async () => {
				if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
				await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
			}).toPass();
			await expect(page).toHaveURL(
				(url) => url.searchParams.get('tab') === (key === 'reliability' ? null : key),
			);
			expect(await page.evaluate(() => history.length)).toBe(entries);
			if (key === 'reliability') continue;
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
test('rankings name lines by number in both languages', async ({ page }) => {
	for (const lang of PUBLISHED_LOCALES) {
		await page.goto(localizeHref('/hotspots', lang));
		await expect(page.locator('[data-slot="hotspots-verdict"]')).toHaveCount(0);
		await page.locator('[data-slot="hotspot-section"]').first().scrollIntoViewIfNeeded();
		const unindexed = page.getByRole('button', {
			name: `${lang === 'fr' ? 'Ligne' : 'Line'} Lansdowne`,
			exact: true,
		});
		await expect(unindexed).toBeVisible();
		const label =
			(await unindexed.evaluate((element) => element.namespaceURI)) === 'http://www.w3.org/2000/svg'
				? page
						.locator('[data-slot="hotspot-section"]')
						.first()
						.locator('svg text')
						.filter({ hasText: /^Lansdowne$/ })
				: unindexed;
		await expect(label).toBeVisible();
		await expect(label).toHaveText('Lansdowne');
		await page.goto(localizeHref('/repeat-offenders', lang));
		await expect(page.locator('[data-slot="offenders-hero"]').getByRole('link')).toHaveText(
			'1 · Confederation',
		);
		await page.goto(localizeHref('/receipt', lang));
		await expect(
			page.locator('[data-slot="receipt-worst"]').getByRole('link', {
				name: /^1 · Confederation/,
			}),
		).toContainText('1 · Confederation');
	}
});
