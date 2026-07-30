import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

// Run against a live Vite dev target:
// node scripts/lang-switch-receipt.mjs http://127.0.0.1:5173
const targetArg = process.argv[2];
if (!targetArg) {
	throw new Error('Usage: node scripts/lang-switch-receipt.mjs <vite-dev-url>');
}

const targetUrl = new URL(targetArg);
if (!['http:', 'https:'].includes(targetUrl.protocol)) {
	throw new Error(`Vite dev URL must use http or https: ${targetUrl.href}`);
}

const startUrl = new URL('/metrics', targetUrl);
const expectedPath = '/fr/metrics';
const expectedHeading = 'Comment on mesure';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({
	headless: true,
	...(executablePath ? { executablePath } : {}),
});

try {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		serviceWorkers: 'block',
	});
	const page = await context.newPage();
	try {
		const response = await page.goto(startUrl.href, { waitUntil: 'domcontentloaded' });
		if (!response?.ok()) {
			throw new Error(
				`Navigation failed (${response?.status() ?? 'no response'}): ${startUrl.href}`,
			);
		}

		const languageSwitch = page.getByRole('link', {
			name: 'Switch language: Français',
			exact: true,
		});
		await languageSwitch.waitFor({ state: 'visible' });
		// The client router must be hydrated before the click, or the click is a
		// native document navigation and the receipt passes even when the reload
		// attribute is absent — i.e. it would prove nothing about the fix.
		await page.waitForLoadState('load');
		await page.waitForLoadState('networkidle');
		const switchHref = await languageSwitch.getAttribute('href');
		const reloadAttr = await languageSwitch.getAttribute('data-sveltekit-reload');

		await Promise.all([
			page.waitForURL((url) => url.pathname === expectedPath),
			languageSwitch.click(),
		]);
		// data-sveltekit-reload makes this a full document navigation, so the
		// asserted DOM belongs to a document that is still loading at
		// domcontentloaded; wait for the heading itself rather than sampling
		// whatever exists at that instant.
		await page.waitForLoadState('load');

		const finalUrl = new URL(page.url());
		const heading = page.getByRole('heading', {
			level: 1,
			name: expectedHeading,
			exact: true,
		});
		const headingVisible = await heading
			.waitFor({ state: 'visible', timeout: 15_000 })
			.then(() => true)
			.catch(() => false);
		const htmlLang = await page.locator('html').getAttribute('lang');
		const failures = [];
		if (reloadAttr === null) {
			failures.push('language anchor is missing data-sveltekit-reload');
		}
		if (switchHref !== expectedPath) {
			failures.push(`switch href: expected ${expectedPath}, got ${String(switchHref)}`);
		}
		if (finalUrl.pathname !== expectedPath) {
			failures.push(`URL path: expected ${expectedPath}, got ${finalUrl.pathname}`);
		}
		if (htmlLang !== 'fr') failures.push(`html lang: expected fr, got ${String(htmlLang)}`);
		if (!headingVisible) failures.push(`missing visible h1: ${expectedHeading}`);

		const receipt = {
			targetUrl: targetUrl.href,
			generatedAt: new Date().toISOString(),
			startUrl: startUrl.href,
			clickCount: 1,
			switchHref,
			reloadAttr,
			hydratedBeforeClick: true,
			finalUrl: finalUrl.href,
			htmlLang,
			expectedHeading,
			headingVisible,
			serviceWorkers: 'block',
			passed: failures.length === 0,
			failures,
		};
		process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
		if (failures.length > 0) {
			throw new Error(`Language-switch receipt failed:\n${failures.join('\n')}`);
		}
	} finally {
		await context.close();
	}
} finally {
	await browser.close();
}
