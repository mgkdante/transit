import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectAccessible } from '@yesid/config/playwright';
import { detailCopy } from '../src/lib/features/stops/stops.copy';
import { stopReliabilityCopy } from '../src/lib/features/stops/reliability/stops-reliability.copy';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';

const departures = JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8'));
const stop = Object.keys(departures.stops)[0]!;

test.use({ bypassCSP: true });
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.clock.setFixedTime(Date.parse(departures.generated_utc) + 30_000);
});

for (const locale of PUBLISHED_LOCALES) {
	for (const reducedMotion of ['reduce', 'no-preference'] as const) {
		test(`${locale} station signage, keyboard and strip geometry with ${reducedMotion} @theme`, async ({
			page,
		}) => {
			await page.emulateMedia({ reducedMotion });
			for (const width of [390, 768, 1280, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				await page.goto(localizeHref(`/stop/${stop}`, locale));
				const tabs = page.getByRole('tablist');
				const first = tabs.getByRole('tab', { name: detailCopy[locale].tabs.detail, exact: true });
				await expect(first).toHaveAttribute('data-state', 'active');
				await expect(tabs).toHaveClass(/station-tabs/);
				await expect(async () => {
					await first.focus();
					await page.keyboard.press('ArrowRight');
					await expect(first).toHaveAttribute('aria-selected', 'false', { timeout: 1000 });
				}).toPass();
				const selected = tabs.locator('[aria-selected="true"]');
				await expect(selected).toBeFocused();
				await expect(selected).toHaveAttribute('data-state', 'active');
				const style = await selected.evaluate((element) => {
					const css = getComputedStyle(element);
					return {
						weight: css.fontWeight,
						ring: css.outlineStyle,
						ringColor: css.outlineColor,
						color: css.color,
						height: element.getBoundingClientRect().height,
					};
				});
				expect(style.weight).toBe('700');
				expect(style.ring).toBe('solid');
				expect(style.ringColor).toBe(style.color);
				expect(style.height).toBeGreaterThanOrEqual(44);
				const geometry = await page
					.locator('[data-slot="entity-detail-tabs"]')
					.evaluate((strip) => {
						const viewport = strip.querySelector('[data-slot="entity-detail-tabs-scroll"]')!;
						const tab = strip.querySelector('[aria-selected="true"]')!;
						const box = viewport.getBoundingClientRect(),
							active = tab.getBoundingClientRect();
						return {
							height: strip.getBoundingClientRect().height,
							expected: parseFloat(getComputedStyle(strip).getPropertyValue('--strip-h')) - 3,
							pageFits: document.documentElement.scrollWidth <= innerWidth,
							visible: active.left >= box.left - 1 && active.right <= box.right + 1,
						};
					});
				expect(Math.abs(geometry.height - geometry.expected)).toBeLessThanOrEqual(1);
				expect(geometry.pageFits).toBe(true);
				await expect
					.poll(async () =>
						selected.evaluate((element) => {
							const viewport = element
								.closest('[data-slot="entity-detail-tabs-scroll"]')!
								.getBoundingClientRect();
							const box = element.getBoundingClientRect();
							return box.left >= viewport.left - 1 && box.right <= viewport.right + 1;
						}),
					)
					.toBe(true);
				await expectAccessible(page, { include: '.entity-tabs' });
			}
		});
	}

	test(`${locale} visible and hidden DetailFrame pills retain their navigation`, async ({
		page,
	}) => {
		await page.goto(localizeHref('/metrics', locale));
		const pill = page.getByTestId('toc-pill').locator('button.toc-pill');
		if (page.viewportSize()!.width < 1024) {
			await expect(pill).toHaveAccessibleName(/Contents|Sommaire/);
			await expect(async () => {
				await pill.click();
				await expect(pill).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
			}).toPass();
			await expect(page.locator('.toc-drawer-backdrop')).toHaveAccessibleName(
				locale === 'en' ? 'Close contents' : 'Fermer le sommaire',
			);
			await page.locator('.toc-drawer-item').first().click();
			await expect(pill).toHaveAttribute('aria-expanded', 'false');
		}
		for (const path of ['/alerts', '/hotspots', '/network', '/receipt', '/repeat-offenders']) {
			await page.goto(localizeHref(path, locale));
			await expect(page.locator('[data-slot="detail-shell"]')).toBeVisible();
			await expect(page.getByTestId('toc-pill')).toHaveCount(0);
		}
	});
}

for (const input of ['desktop', 'touch-only', 'hybrid'] as const) {
	for (const reducedMotion of ['reduce', 'no-preference'] as const) {
		test(`${input} real wordmark and GrainPicker policy with ${reducedMotion} @theme`, async ({
			browser,
			baseURL,
		}, testInfo) => {
			const context = await browser.newContext({
				baseURL,
				bypassCSP: true,
				viewport: { width: 1280, height: 900 },
				hasTouch: input === 'touch-only',
				isMobile: input === 'touch-only',
				reducedMotion,
				storageState: {
					cookies: [],
					origins: [
						{ origin: baseURL!, localStorage: [{ name: 'theme', value: testInfo.project.name }] },
					],
				},
			});
			try {
				if (input === 'hybrid')
					await context.addInitScript(() =>
						Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }),
					);
				const page = await context.newPage();
				await page.clock.install({ time: new Date(Date.parse(departures.generated_utc) + 30_000) });
				await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
				await page.goto(`/stop/${stop}?tab=reliability`);
				await expect(
					page.getByRole('radiogroup', { name: stopReliabilityCopy.en.grain.label }).first(),
				).toBeVisible();
				await page.clock.pauseAt(new Date(Date.parse(departures.generated_utc) + 35_000));
				const capabilities = await page.evaluate(() => ({
					pointer: matchMedia('(any-hover: hover) and (any-pointer: fine)').matches,
					touch: navigator.maxTouchPoints,
				}));
				expect(capabilities.pointer).toBe(input !== 'touch-only');
				expect(capabilities.touch > 0).toBe(input !== 'desktop');
				const wordmarks = page.locator('[data-slot="wordmark-letters"]');
				expect(await wordmarks.count()).toBeGreaterThan(0);
				for (const wordmark of await page.locator('header [data-slot="wordmark-letters"]').all()) {
					const letters = (await wordmark.textContent())!.length;
					await expect
						.poll(() => wordmark.locator('div').count())
						.toBe(input !== 'touch-only' && reducedMotion === 'no-preference' ? letters : 0);
				}
				await expect(page.locator('footer [data-slot="wordmark-letters"] div')).toHaveCount(0);
				const segment = page
					.getByRole('radiogroup', { name: stopReliabilityCopy.en.grain.label })
					.first()
					.getByRole('radio', { checked: true });
				await expect(segment).toHaveClass(/tap-press/);
				await segment.dispatchEvent('mouseenter');
				if (input === 'touch-only') {
					await expect(segment).not.toHaveAttribute('style', /scale\(1\.04\)/);
					await segment.dispatchEvent('pointerdown', { pointerType: 'touch' });
					await page.clock.runFor(150);
					await expect(segment).toHaveAttribute('style', /scale\(0\.94/);
					await segment.dispatchEvent('pointercancel', { pointerType: 'touch' });
				} else {
					await expect(segment).toHaveAttribute('style', /scale\(1\.04\)/);
					await segment.dispatchEvent('pointerdown', {
						pointerType: input === 'hybrid' ? 'touch' : 'mouse',
					});
					await page.clock.runFor(150);
					await expect(segment).toHaveAttribute('style', /scale\(1\.04\)/);
				}
				await page.clock.runFor(650);
				if (input !== 'touch-only')
					await expect(segment).not.toHaveAttribute('style', /transform:\s*scale/);
				await segment.focus();
				await expect(segment).toBeFocused();
			} finally {
				await context.close();
			}
		});
	}
}

for (const locale of PUBLISHED_LOCALES) {
	for (const reducedMotion of ['reduce', 'no-preference'] as const) {
		test(`${locale} real SurfaceRail touch, focus and ${reducedMotion} @theme`, async ({
			browser,
			baseURL,
		}, testInfo) => {
			const context = await browser.newContext({
				baseURL,
				bypassCSP: true,
				viewport: { width: 390, height: 844 },
				hasTouch: true,
				isMobile: true,
				reducedMotion,
				storageState: {
					cookies: [],
					origins: [
						{ origin: baseURL!, localStorage: [{ name: 'theme', value: testInfo.project.name }] },
					],
				},
			});
			try {
				const page = await context.newPage();
				await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
				await page.goto(localizeHref(`/stop/${stop}?tab=reliability`, locale));
				const pill = page.locator('.surface-rail-pill');
				const sheet = page.getByRole('dialog', {
					name: stopReliabilityCopy[locale].controlsLabel,
					exact: true,
				});
				await expect(async () => {
					if (!(await sheet.isVisible())) await pill.tap();
					await expect(sheet).toBeVisible({ timeout: 1000 });
				}).toPass();
				await expect(sheet.locator('[data-slot="surface-rail"]')).toBeVisible();
				await expect(sheet.locator('[data-slot="sheet-header"]')).toHaveCount(0);
				const motion = await sheet.evaluate((element) => {
					const style = getComputedStyle(element);
					return { animation: style.animationName, transition: style.transitionProperty };
				});
				if (reducedMotion === 'reduce') {
					expect(motion.animation).toBe('none');
					expect(motion.transition).toBe('none');
				} else expect(motion.animation).not.toBe('none');
				const segment = sheet.getByRole('radio', { disabled: false }).first();
				await segment.tap();
				await expect(segment).toHaveAttribute('aria-checked', 'true');
				await page.keyboard.press('Tab');
				expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(
					true,
				);
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();
				await expect(pill).toBeFocused();
			} finally {
				await context.close();
			}
		});
	}
}
