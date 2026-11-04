import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { navPillCopy } from '../src/lib/i18n/messages';
import { SURFACE_NAV } from '../src/lib/content/nav';

const { PUBLIC_PLAUSIBLE_DOMAIN: domain, PUBLIC_CF_BEACON_TOKEN: beaconToken } = JSON.parse(
	readFileSync(new URL('./wrangler.json', import.meta.url), 'utf8'),
).vars;

const port = process.env.TRANSIT_E2E_PORT ?? '4317';
const ENDPOINT = 'https://plausible.io/api/event';
type Payload = { n: string; d: string; u: string; p?: Record<string, string> };

// The production CSP upgrades this synthetic HTTP hostname's assets to HTTPS.
test.use({ bypassCSP: true });

async function capturePlausible(page: Page): Promise<Payload[]> {
	const payloads: Payload[] = [];
	await page.route('**/api/event', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		payloads.push(route.request().postDataJSON() as Payload);
		await route.fulfill({ status: 202, contentType: 'text/plain', body: '' });
	});
	return payloads;
}

async function captureBeacon(page: Page): Promise<URL[]> {
	const requests: URL[] = [];
	await page.route('https://static.cloudflareinsights.com/**', async (route) => {
		requests.push(new URL(route.request().url()));
		await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
	});
	return requests;
}

async function openMenu(page: Page) {
	const menu = page.getByRole('navigation', { name: navPillCopy.en.menu });
	await expect(async () => {
		if (!(await menu.isVisible()))
			await page.getByRole('button', { name: navPillCopy.en.openMenu }).click();
		await expect(menu).toBeVisible({ timeout: 1000 });
	}).toPass();
	return menu;
}

test.beforeEach(async ({ page }) => {
	await page.route(`http://${domain}:${port}/**`, async (route) => {
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
	const beacon = await captureBeacon(page);
	await page.goto(`http://${domain}:${port}/?utm_source=e2e&q=12+Main+St`);
	await expect.poll(() => payloads.filter(({ n }) => n === 'pageview').length).toBe(1);
	await expect
		.poll(() => beacon.map((url) => url.searchParams.get('token')))
		.toEqual([beaconToken]);
	const menu = await openMenu(page);
	await menu
		.getByRole('link', {
			name: SURFACE_NAV.find(({ href }) => href === '/lines')!.label.en,
			exact: true,
		})
		.click();
	await expect(page).toHaveURL((url) => url.pathname === '/lines');
	await expect.poll(() => payloads.filter(({ n }) => n === 'pageview').length).toBe(2);
	for (const payload of payloads) {
		expect(payload.d).toBe(domain);
		expect(payload.p).toEqual({ locale: 'en', provider: 'stm' });
		const url = new URL(payload.u);
		expect(['', '?utm_source=e2e']).toContain(url.search);
		expect(url.hash).toBe('');
	}
	expect(await page.evaluate(() => document.cookie)).toBe('');
	expect(
		await page.evaluate(() =>
			[...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) =>
				/plausible|analytics/i.test(key),
			),
		),
	).toEqual([]);
});

test('a portfolio link click is a custom event', async ({ page, context }) => {
	const payloads = await capturePlausible(page);
	await captureBeacon(page);
	await context.route('https://yesid.dev/**', (route) =>
		route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
	);
	await page.goto(`http://${domain}:${port}/`);
	await expect.poll(() => payloads.filter(({ n }) => n === 'pageview').length).toBe(1);
	const menu = await openMenu(page);
	const popup = context.waitForEvent('page');
	await menu.getByRole('link', { name: /^Yesid/ }).click();
	await popup;
	await expect
		.poll(() => payloads.find(({ n }) => n === 'Portfolio Click')?.p)
		.toEqual({ locale: 'en', provider: 'stm', placement: 'menu' });
});

test('a missing page sends a 404 event with only its path', async ({ page }) => {
	const payloads = await capturePlausible(page);
	await captureBeacon(page);
	await page.goto(`http://${domain}:${port}/no-such-page?q=12+Main+St`);
	await expect
		.poll(() => payloads.map(({ n }) => n))
		.toEqual(expect.arrayContaining(['pageview', '404']));
	const event = payloads.find(({ n }) => n === '404')!;
	expect(new URL(event.u).pathname).toBe('/no-such-page');
	expect(new URL(event.u).search).toBe('');
	expect(payloads.filter(({ n }) => n === '404')).toHaveLength(1);
});

test('the local host sends nothing', async ({ page }) => {
	const payloads = await capturePlausible(page);
	const beacon = await captureBeacon(page);
	await page.goto(`http://127.0.0.1:${port}/?utm_source=e2e&q=12+Main+St`);
	const menu = await openMenu(page);
	await menu
		.getByRole('link', {
			name: SURFACE_NAV.find(({ href }) => href === '/lines')!.label.en,
			exact: true,
		})
		.click();
	await expect(page).toHaveURL((url) => url.pathname === '/lines');
	await page.evaluate(
		(endpoint) =>
			fetch(endpoint, { method: 'POST', body: JSON.stringify({ n: '__e2e-drain__' }) }).catch(
				() => undefined,
			),
		ENDPOINT,
	);
	await expect.poll(() => payloads.some(({ n }) => n === '__e2e-drain__')).toBe(true);
	expect(payloads.filter(({ n }) => n !== '__e2e-drain__')).toEqual([]);
	expect(beacon).toEqual([]);
});
