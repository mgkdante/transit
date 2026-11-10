import { test } from './layout-test';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const shots = fileURLToPath(new URL('../../../.cache/cohesion/after/', import.meta.url));
mkdirSync(shots, { recursive: true });
test.describe.configure({ mode: 'parallel' });
const epoch = Date.parse(
	JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8')).generated_utc,
);
async function captureDetail(
	page: Page,
	provider: string,
	locale: string,
	width: number,
	kind: string,
) {
	const prefix =
		shots +
		'/' +
		provider +
		'-' +
		locale +
		'-' +
		width +
		'-' +
		kind +
		'-' +
		(test.info().project.use.colorScheme ?? 'light');
	await page.screenshot({ animations: 'disabled', path: prefix + '.png' });
	if (width === 390) {
		const handle = page.locator('[data-sheet-handle]');
		await expect(page.locator('[data-slot="bottom-sheet"]')).toHaveAttribute('data-detent', 'half');
		await handle.press('End');
		await expect(page.locator('[data-slot="bottom-sheet"]')).toHaveAttribute('data-detent', 'full');
		await page.screenshot({ animations: 'disabled', path: prefix + '-full.png' });
		await handle.press('Home');
		await expect(page.locator('[data-slot="bottom-sheet"]')).toHaveAttribute('data-detent', 'peek');
		await page.screenshot({ animations: 'disabled', path: prefix + '-peek.png' });
		await handle.press('ArrowUp');
	}
}
type Probe = { loaded: boolean; project(c: number[]): { x: number; y: number } };
// A long unbroken alert is what once pushed detail content past the panel edge.
const longAlert = {
	id: 'layout-long-alert',
	header_key: 'layout-long-alert',
	severity: 'high',
	routes: ['24'],
	stops: [],
	header_text:
		'Certains arrets sont annules, deplaces ou relocalises. 54393 (Monk / Philippe-Turcot) est deplace au coin nord-est jusqu a nouvel ordre.',
	header_text_en:
		'Some stops are cancelled, moved or relocated. 54393 (Monk / Philippe-Turcot) is moved to the northeast corner until further notice.',
	url: 'https://www.stm.info/fr/infos/etat-du-service',
	url_en: 'https://www.stm.info/en/info/service-status',
};
async function expectContained(page: Page, selector: string) {
	const escaped = await page.locator(selector).evaluate((panel) => {
		const edge = panel.getBoundingClientRect();
		return [...panel.querySelectorAll<HTMLElement>('[data-slot="detail-body"] *')]
			.filter((node) => node.checkVisibility() && !node.closest('.sr-only'))
			.filter((node) => {
				const box = node.getBoundingClientRect();
				return box.width > 0 && (box.right > edge.right + 1 || box.left < edge.left - 1);
			})
			.map((node) => node.tagName + '.' + node.className)
			.slice(0, 5);
	});
	expect(escaped, 'detail content escapes the panel').toEqual([]);
}
for (const provider of ['stm', 'octranspo'])
	for (const locale of ['en', 'fr'])
		for (const { width, height } of [
			{ width: 390, height: 844 },
			{ width: 844, height: 390 },
			{ width: 1280, height: 900 },
		]) {
			test(`${provider} ${locale} ${width} detail navigation @layout`, async ({ page }) => {
				await page.setViewportSize({ width, height });
				await page.clock.setFixedTime(epoch + 30000);
				await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
				await page.route('**/v1/**', async (route) => {
					const url = new URL(route.request().url());
					url.pathname = '/__layout/fresh' + url.pathname;
					const response = await route.fetch({ url: url.href });
					if (url.pathname.endsWith('/live/vehicles.json')) {
						const data = await response.json();
						data.vehicles.push({
							...data.vehicles[0],
							id: 'layout-bus-2',
							lon: data.vehicles[0].lon + 0.002,
						});
						await route.fulfill({ response, json: data });
					} else if (url.pathname.endsWith('/live/alerts.json')) {
						const data = await response.json();
						data.alerts = [longAlert];
						await route.fulfill({ response, json: data });
					} else await route.fulfill({ response });
				});
				await page.goto(
					`${locale === 'fr' ? '/fr' : ''}/map?provider=${provider}&focus=vehicle:layout-bus`,
					{ waitUntil: 'networkidle' },
				);
				await expect
					.poll(() =>
						page.evaluate(() =>
							Boolean((window as unknown as { __transitMap: Probe }).__transitMap?.loaded),
						),
					)
					.toBe(true);
				const point = await page.evaluate(
					(provider) =>
						(window as unknown as { __transitMap: Probe }).__transitMap.project(
							provider === 'stm' ? [-73.59, 45.51] : [-75.69, 45.41],
						),
					provider,
				);
				await page.locator('.maplibregl-canvas').click({ position: point });
				const selector = width < 1024 ? '[data-slot="bottom-sheet"]' : '[data-slot="right-panel"]';
				const panel = page.locator(selector);
				await expect(panel).toBeVisible();
				const nav = panel.getByRole('navigation');
				if (width < 1024) {
					await expect(nav).toBeInViewport({ ratio: 1 });
					const geometry = await nav.evaluate((el) => {
						const actions = el.querySelector('.detail-navigation-actions')!.getBoundingClientRect();
						const tabs = el.querySelector('[role="tablist"]')!.getBoundingClientRect();
						return {
							actionsTop: actions.top,
							tabsTop: tabs.top,
							height: el.getBoundingClientRect().height,
						};
					});
					expect(geometry.tabsTop).toBeCloseTo(geometry.actionsTop, 0);
					expect(geometry.height).toBeLessThanOrEqual(44);
				}
				const back = nav.getByRole('button', {
					name: locale === 'fr' ? 'Retour' : 'Back',
					exact: true,
				});
				const forward = nav.getByRole('button', {
					name: locale === 'fr' ? 'Suivant' : 'Forward',
					exact: true,
				});
				await expect(back).toBeDisabled();
				// The full-analysis link lives once, in the panel footer, not in the toolbar.
				await expect(nav.getByRole('link')).toHaveCount(0);
				await expect(
					page.locator(selector + ' [data-slot="detail-footer-action"]'),
				).toHaveAttribute(
					'href',
					new RegExp(provider === 'octranspo' ? 'provider=octranspo' : 'trip/'),
				);
				await expect(
					panel.getByRole('button', {
						name: locale === 'fr' ? 'Sélectionner la ligne 24' : 'Select route 24',
						exact: true,
					}),
				).toBeVisible();
				await captureDetail(page, provider, locale, width, 'vehicle');
				if (width < 1024) await expectContained(page, selector);
				else
					for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft'] as const) {
						// 400 -> 320 -> 400 -> 560: every open snap keeps the detail inside.
						await page.locator('[data-slot="map-detail-handle"]').press(key);
						await expectContained(page, selector);
					}
				const nextVehicle = nav.getByRole('button', {
					name: locale === 'fr' ? 'Véhicule suivant sur cette ligne' : 'Next vehicle on this line',
					exact: true,
				});
				await expect(nextVehicle).toBeEnabled();
				await nextVehicle.click();
				await expect(panel.locator('[data-slot="detail-identity"]')).toContainText('layout-bus-2');
				if (width >= 1024)
					await nav
						.getByRole('button', {
							name:
								locale === 'fr'
									? 'Véhicule précédent sur cette ligne'
									: 'Previous vehicle on this line',
							exact: true,
						})
						.press('ArrowLeft');
				else await back.click();
				await expect(panel.locator('[data-slot="detail-identity"]')).toHaveText(/layout-bus$/);
				if (width < 1024) {
					const stops = nav.getByRole('tab', {
						name: locale === 'fr' ? 'Arrêts' : 'Stops',
						exact: true,
					});
					await stops.click();
					await expect(stops).toHaveAttribute('aria-selected', 'true');
				}

				await panel
					.getByRole('button', {
						name: locale === 'fr' ? 'Sélectionner la ligne 24' : 'Select route 24',
						exact: true,
					})
					.click();
				await expect(panel.locator('[data-slot="detail-body"]')).toHaveAttribute(
					'data-kind',
					'route',
				);
				await captureDetail(page, provider, locale, width, 'line');
				await back.click();
				await expect(forward).toBeEnabled();
				await forward.click();
				await back.click();
				await panel
					.getByRole('button', { name: /^(Select stop|Sélectionner l.arrêt)/ })
					.first()
					.click();
				await expect(panel.locator('[data-slot="detail-body"]')).toHaveAttribute(
					'data-kind',
					'stop',
				);
				await expect(forward).toBeDisabled();
				await captureDetail(page, provider, locale, width, 'stop');
				expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
				if (provider === 'stm' && locale === 'fr' && width === 390) {
					await page.evaluate(() => {
						document.documentElement.classList.add('dark');
						document.documentElement.dataset.theme = 'dark';
					});
					await page.screenshot({
						animations: 'disabled',
						path: `${shots}/stm-fr-390-stop-dark.png`,
					});
				}
			});
		}
