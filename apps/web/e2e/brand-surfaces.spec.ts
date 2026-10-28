import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { detailCopy } from '../src/lib/features/stops/stops.copy';

const departures = JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8'));
const stop = Object.keys(departures.stops)[0]!;

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

test('the stops listing header draws in as the page scrolls', async ({ page }) => {
	test.skip(page.viewportSize()!.width < 1024, 'the scrub runs from 1024px');
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/stops');
	const art = page.locator('[data-slot="listing-frame"] .blueprint-bg svg path').first();
	const fraction = () =>
		art.evaluate((p: SVGPathElement) => {
			const [d, t] = p.style.strokeDasharray.split(',').map(parseFloat);
			return d / t;
		});
	await expect.poll(fraction).toBeGreaterThan(0);
	const before = await fraction();
	const viewport = page.viewportSize()!;
	await page.mouse.move(viewport.width / 2, viewport.height / 2);
	await page.mouse.wheel(0, 800);
	await expect.poll(fraction).toBeGreaterThan(before);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.reload();
	await expect.poll(() => art.evaluate((p: SVGPathElement) => p.style.strokeDasharray)).toBe('');
});

test("a metric's defining SQL is a named, keyboard-reachable region", async ({ page }) => {
	await page.goto('/metrics');
	const sqlCards = '[data-slot="typed-information-card"][data-kind="sql"]';
	const region = page.locator(sqlCards).first().getByRole('region');
	await expect(region).toBeVisible();
	await expect(region).toHaveAccessibleName(/\S/);
	await region.focus();
	await expect(region).toBeFocused();
	await expect(region).toContainText(/SELECT/i);
	const { violations } = await new AxeBuilder({ page }).include(sqlCards).analyze();
	expect(violations).toEqual([]);
});

test("a stop page's header canvas is decorative and fills the header", async ({ page }) => {
	await page.goto('/stop/' + stop);
	const header = page.locator('[data-slot="article-header"]');
	const canvas = header.locator('canvas').first();
	await expect(canvas).toHaveAttribute('aria-hidden', 'true');
	await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(0);
	await expect
		.poll(async () => {
			const actual = (await canvas.boundingBox())!;
			const expected = (await header.boundingBox())!;
			return Math.max(
				...(['x', 'y', 'width', 'height'] as const).map((key) =>
					Math.abs(actual[key] - expected[key]),
				),
			);
		})
		.toBeLessThanOrEqual(1);
});

test("a detail page's back link sits midway between the chrome and the next line", async ({
	page,
}) => {
	await page.goto('/stop/' + stop);
	const link = page.getByRole('link', { name: detailCopy.en.back, exact: true });
	await expect(link).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await expect
		.poll(async () => {
			const [above, below] = await page.evaluate(
				({ back, network }) => {
					const link = [...document.querySelectorAll('a')].find(
						(a) => a.textContent?.trim() === back,
					)!;
					const range = document.createRange();
					range.selectNodeContents(link);
					const text = range.getBoundingClientRect();
					const pill = document.querySelector('[data-testid="nav-pill"]')!.getBoundingClientRect();
					const select = document
						.querySelector(`select[aria-label="${network}"]`)!
						.parentElement!.getBoundingClientRect();
					const chrome = Math.max(pill.bottom, select.bottom);
					return [
						text.top - chrome,
						link.nextElementSibling!.getBoundingClientRect().top - text.bottom,
					];
				},
				{ back: detailCopy.en.back, network: navPillCopy.en.network },
			);
			return Math.abs(above - below);
		})
		.toBeLessThanOrEqual(1);
});
