import { createRequire } from 'node:module';
import {
	BLUEPRINT_TOKEN_VALUES,
	measureBlueprintDocument,
	parseBlueprintDensityArgs,
	validateBlueprintDensity,
} from './blueprint-density-core.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const { previewUrl, theme, viewport } = parseBlueprintDensityArgs(process.argv.slice(2));
const routes = [
	{ name: 'lines', path: '/lines' },
	{ name: 'stops', path: '/stops' },
];
const tokenValues = BLUEPRINT_TOKEN_VALUES[theme];
const headerSelector = '[data-slot="blueprint-listing-header"]';

async function settle(page) {
	await page.waitForSelector(`${headerSelector} [data-slot="listing-header-stats"]`, {
		state: 'visible',
	});
	await page.evaluate(async (selector) => {
		await document.fonts.ready;
		const header = document.querySelector(selector);
		let previous = '';
		let stableFrames = 0;
		while (stableFrames < 3) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const box = header.getBoundingClientRect();
			const current = `${box.x}:${box.y}:${box.width}:${box.height}`;
			stableFrames = current === previous ? stableFrames + 1 : 0;
			previous = current;
		}
	}, headerSelector);
}

async function measure(page, route) {
	const url = new URL(route.path, `${previewUrl.origin}/`).href;
	const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
	if (!response?.ok()) {
		throw new Error(`Navigation failed (${response?.status() ?? 'no response'}): ${url}`);
	}
	await settle(page);

	return page.evaluate(measureBlueprintDocument, {
		headerSelector,
		routeName: route.name,
		tokenValues,
		url,
	});
}

const browser = await chromium.launch({ headless: true });
try {
	const context = await browser.newContext({
		viewport,
		colorScheme: theme,
		serviceWorkers: 'block',
	});
	await context.addInitScript(
		(selectedTheme) => localStorage.setItem('theme', selectedTheme),
		theme,
	);
	const page = await context.newPage();
	const pages = [];
	const failures = [];
	for (const route of routes) {
		const result = await measure(page, route);
		const validation = validateBlueprintDensity(result, { theme, viewport });
		pages.push({
			...result,
			summary: validation.summary,
			labelWarnings: validation.labelWarnings,
			heroLabelWarnings: validation.heroLabelWarnings,
		});
		failures.push(...validation.failures);
	}
	await context.close();

	const refLabelWarnings = pages.flatMap((result) =>
		result.refLabelWarnings.map((warning) => ({ route: result.name, ...warning })),
	);
	const receipt = {
		previewUrl: previewUrl.href,
		generatedAt: new Date().toISOString(),
		viewport,
		theme,
		routes,
		passed: failures.length === 0,
		failures,
		refLabelWarnings,
		pages,
	};
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
	if (failures.length > 0) {
		throw new Error(`Blueprint density check failed:\n${failures.join('\n')}`);
	}
} finally {
	await browser.close();
}
