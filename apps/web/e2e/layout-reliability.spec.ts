import { test } from './layout-test';
import { expect } from '@playwright/test';
import { forwardRoute } from './layout-helpers';
import { expectLayout } from './layout-debt';
import { localizeHref } from '../src/lib/i18n/routing';

for (const locale of ['en', 'fr'] as const)
	test(`${locale} hedged lines preserve name and number @layout`, async ({ page }, info) => {
		await page.clock.setFixedTime(Date.parse('2026-06-15T12:00:30Z'));
		await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
		await page.route('**/v1/**', (route) =>
			forwardRoute(page, async () => {
				const url = new URL(route.request().url());
				const state =
					url.pathname.endsWith('/historic/route_reliability/24.json') ||
					url.pathname.endsWith('/static/routes_index.json')
						? 'hedged'
						: 'fresh';
				url.pathname = `/__layout/${state}${url.pathname}`;
				await route.fulfill({ response: await route.fetch({ url: url.href }) });
			}),
		);
		await page.goto(localizeHref('/lines', locale), { waitUntil: 'networkidle' });
		const row = page.locator('[data-slot="entity-result-row"]').first();
		const hedge = row.locator('[data-slot="reliability-hedge"]');
		// Reliability loads when a row enters the viewport; short landscape screens start it below the fold.
		await row.scrollIntoViewIfNeeded();
		await expect(hedge).toHaveAttribute('data-status', 'tentative');
		await expect(hedge).toHaveAttribute('title', /368/);
		await page.evaluate(() => document.fonts.ready);
		const viewport = page.viewportSize()!;
		for (const size of [
			viewport,
			...(viewport.width === 1280 ? [{ width: 1440, height: 900 }] : []),
		]) {
			await page.setViewportSize(size);
			const defects = await row.evaluate((element) => {
				const card = element.closest('[data-slot="card"]') ?? element.parentElement!;
				const bounds = card.getBoundingClientRect();
				const reliability = element
					.querySelector('[data-slot="reliability-hedge"]')!
					.getBoundingClientRect();
				return [
					...element.querySelectorAll<HTMLElement>(
						'.readable-name, [data-slot="reliability-hedge"], [data-slot="entity-result-action"]',
					),
				].flatMap((node) => {
					const box = node.getBoundingClientRect();
					const errors: string[] = [];
					if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
						errors.push(`truncated: ${node.textContent}`);
					if (
						box.left < bounds.left ||
						box.right > bounds.right + 1 ||
						box.top < bounds.top ||
						box.bottom > bounds.bottom + 1
					)
						errors.push(`outside card: ${node.textContent}`);
					if (
						node.matches('.readable-name') &&
						box.left < reliability.right &&
						box.right > reliability.left &&
						box.top < reliability.bottom &&
						box.bottom > reliability.top
					)
						errors.push(`overlap: ${node.textContent}`);
					return errors;
				});
			});
			expect(defects).toEqual([]);
			await expectLayout(page, info, []);
			if (size.width === 1440) {
				const path = info.outputPath('hedged-lines-1440.png');
				await page.screenshot({ path });
				await info.attach('hedged-lines-1440', {
					path,
					contentType: 'image/png',
				});
			}
		}
	});
