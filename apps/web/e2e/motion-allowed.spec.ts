import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';
import { navPillCopy } from '../src/lib/i18n/messages';

const read = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
const provider = read('manifest').provider;
const line = read('routes-index').routes[0].id;
const stop = Object.keys(read('departures').stops)[0];
const trip = Object.keys(read('trips').trips)[0];
const paths = [
	'/',
	'/map',
	'/lines',
	`/lines/${line}`,
	'/stops',
	`/stop/${stop}`,
	`/trip/${trip}`,
	'/hotspots',
	'/metrics',
	'/network',
	'/status',
	'/search',
	'/alerts',
	'/receipt',
	'/repeat-offenders',
	'/accessibility',
	'/privacy',
	'/terms',
];

const PRODUCT_LOOPS = ['[data-motion="refresh-busy"]'] as const;
// Must be empty once v0.42.0 is adopted; PR 856 deletes this list.
const SHARED_LOOPS_UNTIL_V0_42 = [
	'[data-slot="footer"] [data-slot="status-dot"]',
	'[data-slot="terminal-panel"] > div:first-child > div:first-child > span[aria-hidden="true"] > span:first-child',
] as const;

async function runningMotion(page: Page) {
	return page.evaluate(
		({ product, shared }) => {
			return document.getAnimations().flatMap((animation) => {
				if (animation.playState !== 'running' || !(animation.effect instanceof KeyframeEffect))
					return [];
				const timing = animation.effect.getTiming();
				if (timing.iterations !== Infinity && Number(timing.duration) <= 10_000) return [];
				const target = animation.effect.target;
				const matches = (selector: string) => target instanceof Element && target.matches(selector);
				return [
					{
						owner: shared.some(matches)
							? 'shared'
							: product.some(matches)
								? 'product'
								: 'unexpected',
						target: target instanceof Element ? target.outerHTML.slice(0, 300) : String(target),
					},
				];
			});
		},
		{ product: PRODUCT_LOOPS, shared: SHARED_LOOPS_UNTIL_V0_42 },
	);
}

async function expectIdle(page: Page) {
	await expect(page.locator('[data-refreshing="true"]')).toHaveCount(0);
	await expect
		.poll(async () => (await runningMotion(page)).filter((a) => a.owner !== 'shared'))
		.toEqual([]);
}

async function expectStaticLiveIndicators(page: Page) {
	const indicators = page
		.locator(
			'[data-variant="live"], [data-live-indicator], [data-motion="live-indicator"], [data-slot="status-dot"]',
		)
		.or(page.getByLabel(/^(?:live|en direct)(?: data| données)?$/i));
	const running = await indicators.evaluateAll(
		(elements, shared) =>
			elements.flatMap((element) =>
				element
					.getAnimations({ subtree: true })
					.filter((animation) => {
						if (animation.playState !== 'running') return false;
						const target =
							animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
						return !(
							target instanceof Element && shared.some((selector) => target.matches(selector))
						);
					})
					.map(() => element.outerHTML.slice(0, 300)),
			),
		SHARED_LOOPS_UNTIL_V0_42,
	);
	expect(running).toEqual([]);
}

test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

for (const locale of PUBLISHED_LOCALES) {
	for (const path of paths) {
		test(`${locale} ${path}: settled pages have no product loops or animated live indicators`, async ({
			page,
		}) => {
			const response = await page.goto(localizeHref(path, locale, provider));
			expect(response?.ok()).toBe(true);
			await expect(page.locator('#main')).toBeVisible();
			await page.waitForLoadState('networkidle');
			await expectIdle(page);
			await expectStaticLiveIndicators(page);
		});
	}

	for (const reducedMotion of ['no-preference', 'reduce'] as const) {
		test(`${locale}: refresh motion is bounded by its request (${reducedMotion})`, async ({
			page,
		}) => {
			await page.emulateMedia({ reducedMotion });
			await page.goto(localizeHref('/', locale, provider));
			await page.waitForLoadState('networkidle');
			await expectIdle(page);
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const request = page.waitForRequest('**/historic/hotspots.json*');
			await page.route('**/historic/hotspots.json*', async (route) => {
				await held;
				await route.continue();
			});
			await page.getByRole('button', { name: navPillCopy[locale].refresh, exact: true }).click();
			await request;
			const busy = page.locator('[data-motion="refresh-busy"]');
			try {
				await expect(busy).toBeVisible();
				await expect(
					page.getByRole('button', { name: navPillCopy[locale].refreshing, exact: true }),
				).toBeDisabled();
				const motion = (await runningMotion(page)).filter((a) => a.owner !== 'shared');
				expect(motion.map((a) => a.owner)).toEqual(reducedMotion === 'reduce' ? [] : ['product']);
				await expectStaticLiveIndicators(page);
			} finally {
				release();
			}
			await expect(busy).toHaveCount(0);
			await expectIdle(page);
		});
	}
}
