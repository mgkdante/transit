import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';
import { navPillCopy } from '../src/lib/i18n/messages';
import { revealHeaderControls } from './header-controls';
import { errorPageCopy } from '../src/lib/site/errorPage';

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

async function runningMotion(page: Page) {
	return page.evaluate((product) => {
		return document.getAnimations().flatMap((animation) => {
			if (animation.playState !== 'running' || !(animation.effect instanceof KeyframeEffect))
				return [];
			const timing = animation.effect.getTiming();
			if (timing.iterations !== Infinity && Number(timing.duration) <= 10_000) return [];
			const target = animation.effect.target;
			const matches = (selector: string) => target instanceof Element && target.matches(selector);
			return [
				{
					owner: product.some(matches) ? 'product' : 'unexpected',
					animation:
						animation instanceof CSSAnimation
							? animation.animationName
							: animation instanceof CSSTransition
								? animation.transitionProperty
								: animation.id,
					target: target instanceof Element ? target.outerHTML.slice(0, 300) : String(target),
				},
			];
		});
	}, PRODUCT_LOOPS);
}

async function expectIdle(page: Page) {
	await expect(page.locator('[data-refreshing="true"]')).toHaveCount(0);
	await expect.poll(() => runningMotion(page)).toEqual([]);
}

async function expectStaticLiveIndicators(page: Page) {
	const indicators = page
		.locator(
			'[data-variant="live"], [data-live-indicator], [data-motion="live-indicator"], [data-slot="status-dot"]',
		)
		.or(page.getByLabel(/^(?:live|en direct)(?: data| données)?$/i));
	const running = await indicators.evaluateAll((elements) =>
		elements.flatMap((element) =>
			element
				.getAnimations({ subtree: true })
				.filter((animation) => animation.playState === 'running')
				.map((animation) => ({
					target: element.outerHTML.slice(0, 300),
					animation: animation instanceof CSSAnimation ? animation.animationName : animation.id,
				})),
		),
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
		test(`${locale}: error-page decoration is still (${reducedMotion})`, async ({ page }) => {
			await page.emulateMedia({ reducedMotion });
			const response = await page.goto(localizeHref('/missing-motion-page', locale, provider));
			expect(response?.status()).toBe(404);
			const errorPage = page.locator('[data-slot="error-page"]');
			await expect(
				errorPage.getByRole('heading', {
					name: errorPageCopy[locale].notFound.heading,
					exact: true,
				}),
			).toBeVisible();
			await page.waitForLoadState('networkidle');
			await expectIdle(page);
			await expectStaticLiveIndicators(page);
		});

		test(`${locale}: refresh motion is bounded by its request (${reducedMotion})`, async ({
			page,
		}) => {
			await page.emulateMedia({ reducedMotion });
			await page.goto(localizeHref('/', locale, provider));
			await page.waitForLoadState('networkidle');
			await expectIdle(page);
			await revealHeaderControls(page, locale);
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const pageOrigin = new URL(page.url()).origin;
			// invalidateAll reloads server data through SvelteKit, not a snapshot endpoint.
			await page.route(
				(url) => url.origin === pageOrigin && url.pathname.endsWith('/__data.json'),
				async (route) => {
					await held;
					await route.continue();
				},
			);
			const busy = page.locator('[data-motion="refresh-busy"]');
			try {
				await page.getByRole('button', { name: navPillCopy[locale].refresh, exact: true }).click();
				const refreshing = page.getByRole('button', {
					name: navPillCopy[locale].refreshing,
					exact: true,
				});
				await expect(refreshing).toHaveAttribute('data-refreshing', 'true');
				await expect(refreshing).toBeDisabled();
				await expect(busy).toBeVisible();
				const motion = await runningMotion(page);
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
