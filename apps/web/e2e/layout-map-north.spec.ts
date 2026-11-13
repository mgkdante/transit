import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { test } from './layout-test';
import { copy } from '../src/lib/features/map/map.copy';
import { localizeHref } from '../src/lib/i18n/routing';

type Probe = {
	loaded: boolean;
	bearing: number;
	pitch: number;
	setOrientation(bearing: number, pitch: number): void;
};
declare global {
	interface Window {
		__transitMap: Probe;
	}
}
const providers = JSON.parse(readFileSync(new URL('./providers.json', import.meta.url), 'utf8'))
	.providers as { id: string }[];
const epoch = Date.parse(
	JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8')).generated_utc,
);

for (const provider of providers)
	for (const locale of ['en', 'fr'] as const)
		test(`${provider.id} ${locale}: the north control appears without moving its neighbours and works by keyboard @layout`, async ({
			page,
		}) => {
			await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
			await page.clock.setFixedTime(epoch + 30_000);
			await page.goto(localizeHref(`/map?provider=${provider.id}`, locale));
			await expect.poll(() => page.evaluate(() => window.__transitMap?.loaded)).toBe(true);
			const t = copy[locale];
			const north = page.getByRole('button', { name: t.northControl, exact: true });
			const neighbours = [
				page.getByRole('button', { name: t.nearMe, exact: true }),
				page.getByLabel(t.attributionToggle, { exact: true }),
			];
			await expect(north).toHaveCount(0);
			await expect(neighbours[0]).toBeVisible();
			await neighbours[1].focus();
			await page.keyboard.press('Tab');
			await expect(neighbours[0]).toBeFocused();
			const before = await Promise.all(neighbours.map((el) => el.boundingBox()));
			await page.evaluate(() => window.__transitMap.setOrientation(35, 30));
			await expect(north).toBeVisible();
			const northBox = (await north.boundingBox())!;
			expect(northBox.width).toBe(44);
			expect(northBox.height).toBe(44);
			const after = await Promise.all(neighbours.map((el) => el.boundingBox()));
			for (const [i, box] of before.entries()) {
				for (const key of ['x', 'y', 'width', 'height'] as const)
					expect(Math.abs(after[i]![key] - box![key])).toBeLessThanOrEqual(1);
				const neighbour = after[i]!;
				expect(
					northBox.x < neighbour.x + neighbour.width &&
						neighbour.x < northBox.x + northBox.width &&
						northBox.y < neighbour.y + neighbour.height &&
						neighbour.y < northBox.y + northBox.height,
				).toBe(false);
			}
			await page.getByLabel(t.attributionToggle, { exact: true }).focus();
			await page.keyboard.press('Tab');
			await expect(north).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(north).toHaveCount(0);
			await expect(page.getByRole('region', { name: t.mapCanvasLabel })).toBeFocused();
			await expect(page.getByRole('status').filter({ hasText: t.northStatus })).toBeVisible();
			await expect
				.poll(() => page.evaluate(() => [window.__transitMap.bearing, window.__transitMap.pitch]))
				.toEqual([0, 0]);
			await page.evaluate(() => window.__transitMap.setOrientation(0, 20));
			await north.click();
			await expect(north).toHaveCount(0);
			await expect(page.getByRole('region', { name: t.mapCanvasLabel })).toBeFocused();
			await page.evaluate(() => window.__transitMap.setOrientation(-20, 0));
			await neighbours[1].focus();
			await page.keyboard.press('Tab');
			await expect(north).toBeFocused();
			await page.keyboard.press('Space');
			await expect(north).toHaveCount(0);
			await expect(page.getByRole('region', { name: t.mapCanvasLabel })).toBeFocused();
		});
