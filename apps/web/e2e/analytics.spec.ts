import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { navPillCopy } from '../src/lib/i18n/messages';
import { SURFACE_NAV, YESID_HOUSE_LINK } from '../src/lib/content/nav';

const { PUBLIC_PLAUSIBLE_DOMAIN: domain, PUBLIC_CF_BEACON_TOKEN: beaconToken } = JSON.parse(
	readFileSync(new URL('./wrangler.json', import.meta.url), 'utf8'),
).vars;

const port = process.env.TRANSIT_E2E_PORT ?? '4317';
// Events go to Transit's own relay route, never straight to plausible.io.
const RELAY_PATH = '/relay/e';
type Payload = { n: string; d: string; u: string; p?: Record<string, string>; at?: string };
let directSends: string[] = [];

// The production CSP upgrades this synthetic HTTP hostname's assets to HTTPS.
test.use({ bypassCSP: true });

async function capturePlausible(page: Page): Promise<Payload[]> {
	const payloads: Payload[] = [];
	await page.route(`**${RELAY_PATH}`, async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		payloads.push({ ...(route.request().postDataJSON() as Payload), at: route.request().url() });
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
	directSends = [];
	await page.route('https://plausible.io/**', async (route) => {
		directSends.push(route.request().url());
		await route.abort();
	});
	await page.route(`http://${domain}:${port}/**`, async (route) => {
		const url = new URL(route.request().url());
		url.hostname = '127.0.0.1';
		await route.continue({ url: url.toString() });
	});
	await page.addInitScript(() => {
		Reflect.set(window, '__plausible', true);
	});
});

test.afterEach(() => {
	expect(directSends, 'no request may go straight to plausible.io').toEqual([]);
});

async function drain(page: Page, payloads: Payload[], marker: string): Promise<void> {
	await page.evaluate(
		([path, n]) =>
			fetch(path, { method: 'POST', body: JSON.stringify({ n }) }).catch(() => undefined),
		[RELAY_PATH, marker] as const,
	);
	await expect.poll(() => payloads.some(({ n }) => n === marker)).toBe(true);
}

test('one page load and one client-side navigation each send exactly one pageview to the relay', async ({
	page,
}) => {
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
	await drain(page, payloads, '__e2e-drain-navigation__');
	const pageviews = payloads.filter(({ n }) => n === 'pageview');
	expect(pageviews.map(({ at }) => at)).toEqual([
		`http://${domain}:${port}${RELAY_PATH}`,
		`http://${domain}:${port}${RELAY_PATH}`,
	]);
	for (const payload of payloads.filter(({ n }) => !n.startsWith('__e2e-drain'))) {
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
	await menu
		.getByRole('link', {
			name: `${YESID_HOUSE_LINK.label.en} ${navPillCopy.en.newTab}`,
			exact: true,
		})
		.click();
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
	await drain(page, payloads, '__e2e-drain__');
	expect(payloads.filter(({ n }) => n !== '__e2e-drain__')).toEqual([]);
	expect(beacon).toEqual([]);
});
