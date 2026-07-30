import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const previewArg = process.argv[2];
if (!previewArg) {
	throw new Error('Usage: node scripts/strip-geometry-probe.mjs <preview-url>');
}

const previewUrl = new URL(previewArg);
if (!['http:', 'https:'].includes(previewUrl.protocol)) {
	throw new Error(`Preview URL must use http or https: ${previewUrl.href}`);
}

const targetPx = 68;
const tolerancePx = 1;
const widths = [375, 768, 1024, 1280];
const themes = ['dark', 'light'];
const locales = [
	{ name: 'en', prefix: '' },
	{ name: 'fr', prefix: '/fr' },
];
const routes = [
	{ name: 'line', path: '/lines/24' },
	{ name: 'stop', path: '/stop/52095' },
];
const shellSelector = '[data-slot="detail-shell"]';
const tapeSelector = `${shellSelector} > [data-slot="separator"].detail-shell-tape`;
const orangeSelector = `${shellSelector} > [data-slot="detail-shell-toolbar"] [data-slot="entity-detail-tabs"]`;
const tablistSelector = `${orangeSelector} [role="tablist"]`;
const activeChipSelector = `${orangeSelector} .station-tab[aria-selected="true"]`;

function pageUrl(prefix, path) {
	return new URL(`${prefix}${path}`, `${previewUrl.origin}/`).href;
}

function round(value) {
	return Math.round(value * 1000) / 1000;
}

async function settle(page) {
	await page.waitForSelector(orangeSelector, { state: 'visible' });
	// Fonts alone are not enough: hydration can reflow the tablist after first
	// paint, so wait until the measured band holds still for three frames.
	await page.evaluate(async (selector) => {
		await document.fonts.ready;
		const el = document.querySelector(selector);
		let last = -1;
		let stable = 0;
		const started = performance.now();
		while (stable < 3 && performance.now() - started < 5000) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const h = el.getBoundingClientRect().height;
			stable = h === last ? stable + 1 : 0;
			last = h;
		}
	}, orangeSelector);
}

async function goto(page, url) {
	const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
	if (!response?.ok()) {
		throw new Error(`Navigation failed (${response?.status() ?? 'no response'}): ${url}`);
	}
	await settle(page);
}

async function rect(page, selector) {
	const locator = page.locator(selector);
	const count = await locator.count();
	if (count !== 1) {
		throw new Error(`Expected one match for ${selector}, found ${count}`);
	}
	return locator
		.evaluate((element) => {
			const box = element.getBoundingClientRect();
			return {
				left: box.left,
				top: box.top,
				right: box.right,
				bottom: box.bottom,
				width: box.width,
				height: box.height,
			};
		})
		.then((box) =>
			Object.fromEntries(Object.entries(box).map(([key, value]) => [key, round(value)])),
		);
}

async function assertRenderContext(page, route, theme, locale) {
	const rendered = await page.locator('html').evaluate((element) => ({
		theme: element.getAttribute('data-theme'),
		locale: element.getAttribute('lang')?.split('-')[0],
	}));
	if (rendered.theme !== theme) {
		throw new Error(`Theme mismatch at ${route}: expected ${theme}, got ${rendered.theme}`);
	}
	if (rendered.locale !== locale) {
		throw new Error(`Locale mismatch at ${route}: expected ${locale}, got ${rendered.locale}`);
	}
}

async function newContext(browser, width, theme) {
	const context = await browser.newContext({
		viewport: { width, height: 900 },
		colorScheme: theme,
		// The PWA service worker can serve stale-build assets mid-matrix and
		// distort a cell; geometry receipts must measure this build only.
		serviceWorkers: 'block',
	});
	await context.addInitScript((selectedTheme) => {
		localStorage.setItem('theme', selectedTheme);
	}, theme);
	return context;
}

async function measureStrip(page, route) {
	const tape = await rect(page, tapeSelector);
	const orange = await rect(page, orangeSelector);
	const tablist = await rect(page, tablistSelector);
	const activeChip = await rect(page, activeChipSelector);
	const composite = {
		left: round(Math.min(tape.left, orange.left)),
		top: tape.top,
		right: round(Math.max(tape.right, orange.right)),
		bottom: orange.bottom,
		width: round(Math.max(tape.right, orange.right) - Math.min(tape.left, orange.left)),
		height: round(orange.bottom - tape.top),
	};
	const deviationPx = round(composite.height - targetPx);

	return {
		...route,
		tape,
		orange,
		tablist,
		activeChip,
		composite,
		adjacencyPx: round(orange.top - tape.bottom),
		deviationPx,
		withinTolerance: Math.abs(deviationPx) <= tolerancePx,
	};
}

async function measureScenario(browser, width, theme, locale) {
	const context = await newContext(browser, width, theme);
	const page = await context.newPage();
	try {
		const strips = [];
		for (const route of routes) {
			const url = pageUrl(locale.prefix, route.path);
			await goto(page, url);
			await assertRenderContext(page, url, theme, locale.name);
			strips.push(await measureStrip(page, { ...route, url }));
		}
		const stripTargetPx = await page
			.locator('html')
			.evaluate((element) =>
				Number.parseFloat(getComputedStyle(element).getPropertyValue('--strip-h')),
			);
		return {
			width,
			height: 900,
			theme,
			locale: locale.name,
			stripTargetPx,
			strips,
		};
	} finally {
		await context.close();
	}
}

const browser = await chromium.launch({ headless: true });
try {
	const matrix = [];
	for (const width of widths) {
		for (const theme of themes) {
			for (const locale of locales) {
				matrix.push(await measureScenario(browser, width, theme, locale));
			}
		}
	}

	const failures = matrix.flatMap((scenario) =>
		scenario.strips
			.filter((strip) => !strip.withinTolerance)
			.map(
				(strip) =>
					`${strip.url} at ${scenario.width}px/${scenario.locale}/${scenario.theme}: ` +
					`${strip.composite.height}px (expected ${targetPx}±${tolerancePx}px)`,
			),
	);
	const receipt = {
		previewUrl: previewUrl.href,
		generatedAt: new Date().toISOString(),
		targetPx,
		tolerancePx,
		widths,
		themes,
		locales: locales.map(({ name }) => name),
		routes,
		passed: failures.length === 0,
		failures,
		matrix,
	};
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
	if (failures.length > 0) {
		throw new Error(`Strip geometry probe failed:\n${failures.join('\n')}`);
	}
} finally {
	await browser.close();
}
