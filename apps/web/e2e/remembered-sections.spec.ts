import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { copy as mapCopy } from '../src/lib/features/map/map.copy';
import { DEFAULT_LOCALE } from '../src/lib/i18n/config';

test.use({ storageState: { cookies: [], origins: [] } });
const b9 = JSON.parse(
	readFileSync(new URL('../scripts/__fixtures__/b9/rich.json', import.meta.url), 'utf8'),
);
const line = JSON.parse(readFileSync(new URL('./routes-index.json', import.meta.url), 'utf8'))
	.routes[0].id;
const stop = JSON.parse(readFileSync(new URL('./stops-index.json', import.meta.url), 'utf8'))
	.stops[0].id;
const departures = JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8'));
const action = (page: Page) => page.getByTestId('sections-toggle').filter({ visible: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.clock.setFixedTime(Date.parse(b9.frozen_utc) + 30_000);
});

test('metrics starts collapsed and remembers the bulk choice across pages and reload', async ({
	page,
}) => {
	await page.goto('/metrics');
	await expect(action(page)).toHaveAccessibleName('Expand all');
	const first = page.locator('[data-testid="metrics-sections"] [data-section-trigger]').first();
	await expect(first).toHaveAttribute('aria-expanded', 'false');
	expect(await page.evaluate(() => localStorage.getItem('sections-choice'))).toBeNull();
	await action(page).click();
	await expect(first).toHaveAttribute('aria-expanded', 'true');
	await page.goto(`/lines/${line}?tab=reliability`);
	await expect(action(page)).toHaveAccessibleName('Collapse all');
	await action(page).click();
	await page.reload();
	await expect(action(page)).toHaveAccessibleName('Expand all');
	expect(await page.evaluate(() => localStorage.getItem('sections-choice'))).toBe('collapsed');
});

test.describe('local data fixture rendering', () => {
	// The fixture uses a separate localhost port outside the production connect-src policy.
	test.use({ bypassCSP: true });
	test('real reliability charts and departure tables measure after content opens', async ({
		page,
	}) => {
		await page.goto(`/lines/${line}?tab=reliability`);
		await expect(action(page)).toHaveAccessibleName('Expand all');
		await action(page).click();
		const chart = page.locator('[data-slot="chart-frame"]').first();
		await chart.scrollIntoViewIfNeeded();
		await expect(chart.locator('svg').first()).toBeVisible();
		const plot = await chart.locator('svg').first().boundingBox();
		expect(plot!.width).toBeGreaterThan(100);
		expect(plot!.height).toBeGreaterThan(0);
		if (page.viewportSize()!.width >= 1024) {
			const independent = page
				.locator('.section-card:not([data-section-bulk]) [data-section-trigger]')
				.first();
			await expect(independent).toHaveAttribute('aria-expanded', 'true');
			await action(page).click();
			await expect(independent).toHaveAttribute('aria-expanded', 'true');
			await action(page).click();
		}
		await page.clock.setFixedTime(Date.parse(departures.generated_utc) + 30_000);
		await page.goto(`/stop/${stop}`);
		const bulk = action(page);
		if (await bulk.count()) {
			await expect(bulk).toBeEnabled();
			if ((await bulk.getAttribute('data-collapsed')) === 'true') await bulk.click();
		}
		const table = page.getByRole('table').first();
		await expect(table).toBeVisible();
		await table.scrollIntoViewIfNeeded();
		expect((await table.boundingBox())!.width).toBeGreaterThan(100);
		await expect(table.getByRole('row')).not.toHaveCount(0);
	});

	test('live departures update while collapsed and measure correctly when reopened', async ({
		page,
	}) => {
		const now = Date.parse(departures.generated_utc) + 30_000;
		await page.clock.install({ time: now });
		let changed = false;
		let reads = 0;
		await page.route('**/live/stop_departures.json', (route) => {
			reads++;
			const payload = structuredClone(departures);
			if (changed) {
				payload.generated_utc = new Date(now + 30_000).toISOString();
				payload.stops[stop].push({ route: 'C10', eta_utc: '2026-06-15T12:15:00Z', delay_min: 1 });
			}
			return route.fulfill({ json: payload });
		});
		await page.goto(`/stop/${stop}`);
		await expect(action(page)).toHaveAccessibleName('Expand all');
		await action(page).click();
		const table = page.getByRole('table').first();
		await expect(table).toBeVisible();
		await expect(table.getByRole('rowheader', { name: 'C10', exact: true })).toHaveCount(0);
		await action(page).click();
		const before = reads;
		changed = true;
		await page.clock.fastForward('00:31');
		await expect.poll(() => reads).toBeGreaterThan(before);
		await action(page).click();
		await expect(table.getByRole('rowheader', { name: 'C10', exact: true })).toBeVisible();
		expect((await table.boundingBox())!.width).toBeGreaterThan(100);
		expect(await page.evaluate(() => localStorage.getItem('sections-choice'))).toBe('expanded');
	});

	test('stored collapse leaves map tools usable and outside the bulk action', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('sections-choice', 'collapsed'));
		await page.goto('/map');
		await expect(action(page)).toHaveCount(0);
		const t = mapCopy[DEFAULT_LOCALE];
		const near = page.getByRole('button', { name: t.nearMe, exact: true });
		await near.click();
		await expect(near).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('searchbox', { name: t.nearMeSearchPlaceholder })).toBeVisible();
		expect(await page.evaluate(() => localStorage.getItem('sections-choice'))).toBe('collapsed');
	});
});
