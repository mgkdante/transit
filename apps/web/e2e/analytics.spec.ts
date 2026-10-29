import { expect, test, type Page } from '@playwright/test';
import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { SURFACE_NAV } from '../src/lib/content/nav';

const ENDPOINT = 'https://plausible.io/api/event';
type Payload = { n: string; d: string; u: string };

async function capturePlausible(page: Page): Promise<Payload[]> {
	const payloads: Payload[] = [];
	await page.route('**/api/event', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		payloads.push(route.request().postDataJSON() as Payload);
		await route.fulfill({ status: 202, contentType: 'text/plain', body: '' });
	});
	return payloads;
}

test.beforeEach(async ({ page }) => {
	await page.route('http://transit.yesid.dev:4317/**', async (route) => {
		const url = new URL(route.request().url());
		url.hostname = '127.0.0.1';
		await route.continue({ url: url.toString() });
	});
	await page.addInitScript(() => {
		Reflect.set(window, '__plausible', true);
	});
});

test('pageviews carry the configured domain and only the path', async ({ page }) => {
	const payloads = await capturePlausible(page);
	await page.goto('http://transit.yesid.dev:4317/?utm_source=e2e&q=12+Main+St');
	await expect.poll(() => payloads.filter(({ n }) => n === 'pageview').length).toBe(1);
	const menu = page.getByRole('navigation', { name: navPillCopy.en.menu });
	await expect(async () => {
		if (!(await menu.isVisible()))
			await page.getByRole('button', { name: navPillCopy.en.openMenu }).click();
		await expect(menu).toBeVisible({ timeout: 1000 });
	}).toPass();
	await menu.getByRole('link', { name: SURFACE_NAV.find(({ href }) => href === '/lines')!.label.en, exact: true }).click();
	await expect(page).toHaveURL((url) => url.pathname === '/lines');
	await expect.poll(() => payloads.filter(({ n }) => n === 'pageview').length).toBe(2);
	for (const payload of payloads) {
		expect(payload.d).toBe('transit.yesid.dev');
		const url = new URL(payload.u);
		expect(['', '?utm_source=e2e']).toContain(url.search);
		expect(url.hash).toBe('');
	}
	expect(await page.evaluate(() => document.cookie)).toBe('');
	expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /plausible|analytics/i.test(key)))).toEqual([]);
});

test('the local host sends nothing', async ({ page }) => {
	const payloads = await capturePlausible(page);
	await page.goto('http://127.0.0.1:4317/?utm_source=e2e&q=12+Main+St');
	const menu = page.getByRole('navigation', { name: navPillCopy.en.menu });
	await expect(async () => {
		if (!(await menu.isVisible()))
			await page.getByRole('button', { name: navPillCopy.en.openMenu }).click();
		await expect(menu).toBeVisible({ timeout: 1000 });
	}).toPass();
	await menu.getByRole('link', { name: SURFACE_NAV.find(({ href }) => href === '/lines')!.label.en, exact: true }).click();
	await expect(page).toHaveURL((url) => url.pathname === '/lines');
	await page.evaluate((endpoint) => fetch(endpoint, { method: 'POST', body: JSON.stringify({ n: '__e2e-drain__' }) }).catch(() => undefined), ENDPOINT);
	await expect.poll(() => payloads.some(({ n }) => n === '__e2e-drain__')).toBe(true);
	expect(payloads.filter(({ n }) => n !== '__e2e-drain__')).toEqual([]);
});
