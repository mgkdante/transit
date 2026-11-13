import { test } from './layout-test';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr']) {
		test(`${provider} ${locale} map controls align and work by keyboard @layout`, async ({
			page,
		}) => {
			await page.goto(`${locale === 'fr' ? '/fr' : ''}/map?provider=${provider}`, {
				waitUntil: 'networkidle',
			});
			if (page.viewportSize()!.width < 1024) await page.getByTestId('map-filter-pill').click();
			const panel = page.locator('.map-filters:visible');
			const stop = panel.getByRole('checkbox', {
				name: locale === 'fr' ? 'Arrêt' : 'Stop',
				exact: true,
			});
			await expect(stop).toHaveAttribute('aria-checked', 'false');
			await stop.press('Space');
			await expect(stop).toHaveAttribute('aria-checked', 'true');
			await expect(page).toHaveURL(/[?&]entity=stop(?:&|$)/);
			await stop.press('Enter');
			await expect(stop).toHaveAttribute('aria-checked', 'false');
			const heading = panel.locator('[data-filter-group="markers"] .mf-group-trigger');
			const row = await stop.boundingBox();
			const header = await heading.boundingBox();
			expect(Math.abs(row!.x - header!.x)).toBeLessThan(1);
			expect(Math.abs(row!.width - header!.width)).toBeLessThan(1);
			expect(row!.height).toBeGreaterThanOrEqual(44);
			expect(await stop.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
			expect((await new AxeBuilder({ page }).include('.map-filters').analyze()).violations).toEqual(
				[],
			);
		});
	}

for (const locale of ['en', 'fr'])
	test(`${locale} map legend has its own aligned surface @layout`, async ({ page }) => {
		await page.goto(`${locale === 'fr' ? '/fr' : ''}/map`, { waitUntil: 'networkidle' });
		const phone = page.viewportSize()!.width < 1024;
		const name = locale === 'fr' ? 'Légende' : 'Legend';
		const card = phone
			? page.locator('[data-slot="map-legend-sheet"]')
			: page.locator('[data-slot="map-legend-card"]');
		if (phone) {
			const fab = page.getByTestId('map-legend-button');
			const button = (await fab.boundingBox())!;
			const controls = (await page.getByTestId('map-filter-pill').boundingBox())!;
			expect(button.width).toBeGreaterThanOrEqual(44);
			expect(button.height).toBeGreaterThanOrEqual(44);
			expect(Math.abs(button.x - controls.x)).toBeLessThanOrEqual(1);
			expect(controls.y - button.y - button.height).toBeCloseTo(10, 0);
			for (const other of await page
				.locator('.map-near-toggle, [data-slot="map-north"], .maplibregl-ctrl-attrib')
				.all()) {
				if (!(await other.isVisible())) continue;
				const box = (await other.boundingBox())!;
				expect(
					button.x + button.width <= box.x ||
						box.x + box.width <= button.x ||
						button.y + button.height <= box.y ||
						box.y + box.height <= button.y,
				).toBe(true);
			}
			await fab.click();
			await expect(fab).toHaveAttribute('aria-expanded', 'true');
		} else {
			const panel = (await page.locator('.map-filter-panel .map-filters').boundingBox())!;
			const box = (await card.boundingBox())!;
			expect(box.y).toBeGreaterThan(panel.y + panel.height);
			expect(Math.abs(box.x - panel.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(box.width - panel.width)).toBeLessThanOrEqual(1);
		}
		await expect(card.getByRole('list', { name })).toBeVisible();
		const geometry = await card.evaluate((root) => {
			const box = root.getBoundingClientRect();
			const rows = [...root.querySelectorAll('[data-legend-entry]')];
			return {
				x: box.x,
				right: box.right,
				top: box.top,
				bottom: box.bottom,
				centres: rows.map((row) => {
					const mark = row.querySelector('.mf-legend-mark')!.getBoundingClientRect();
					return mark.x + mark.width / 2;
				}),
				labels: rows.map(
					(row) => row.querySelector('[data-slot="map-legend-label"]')!.getBoundingClientRect().x,
				),
				clipped: [root, ...rows].some((row) => row.scrollWidth > row.clientWidth + 1),
			};
		});
		for (const value of geometry.centres)
			expect(Math.abs(value - geometry.centres[0])).toBeLessThanOrEqual(1);
		for (const value of geometry.labels)
			expect(Math.abs(value - geometry.labels[0])).toBeLessThanOrEqual(1);
		expect(geometry.clipped).toBe(false);
		expect(geometry.x).toBeGreaterThanOrEqual(0);
		expect(geometry.right).toBeLessThanOrEqual(page.viewportSize()!.width);
		expect(geometry.top).toBeGreaterThanOrEqual(0);
		expect(geometry.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
		expect(
			(
				await new AxeBuilder({ page })
					.include(phone ? '[data-slot="map-legend-sheet"]' : '[data-slot="map-legend-card"]')
					.analyze()
			).violations,
		).toEqual([]);
		if (phone) {
			await page.getByTestId('map-legend-button').click();
			await expect(card).toBeHidden();
			await page.getByTestId('map-filter-pill').click();
			await page.getByTestId('map-legend-button').click();
			await expect(page.getByTestId('map-filter-drawer')).toBeHidden();
			await expect(card).toBeVisible();
		} else {
			await card.getByRole('button', { name }).click();
			await expect(card.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
			await expect(card.getByRole('list')).toBeHidden();
			await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThanOrEqual(46);
		}
	});
