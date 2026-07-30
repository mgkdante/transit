import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const previewArg = process.argv[2];
if (!previewArg) {
	throw new Error('Usage: node scripts/blueprint-density-check.mjs <preview-url>');
}

const previewUrl = new URL(previewArg);
if (!['http:', 'https:'].includes(previewUrl.protocol)) {
	throw new Error(`Preview URL must use http or https: ${previewUrl.href}`);
}

const viewport = { width: 1280, height: 900 };
const routes = [
	{ name: 'lines', path: '/lines' },
	{ name: 'stops', path: '/stops' },
];
const tokenValues = {
	'--blueprint-ink-quiet': 0.14,
	'--blueprint-ink-mid': 0.22,
	'--blueprint-ink-accent': 0.3,
};
const headerSelector = '[data-slot="blueprint-listing-header"]';

function round(value) {
	return Math.round(value * 1000) / 1000;
}

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

	return page.evaluate(
		({ headerSelector: selector, routeName, tokenValues: expectedTokens, url: pageUrl }) => {
			const header = document.querySelector(selector);
			const headerBox = header.getBoundingClientRect();
			const rootStyle = getComputedStyle(document.documentElement);
			const tokens = Object.fromEntries(
				Object.keys(expectedTokens).map((name) => [
					name,
					Number.parseFloat(rootStyle.getPropertyValue(name)),
				]),
			);
			const relativeRect = (box) => ({
				xPct: ((box.left - headerBox.left) / headerBox.width) * 100,
				yPct: ((box.top - headerBox.top) / headerBox.height) * 100,
				wPct: (box.width / headerBox.width) * 100,
				hPct: (box.height / headerBox.height) * 100,
			});
			const intersects = (a, b) =>
				a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
			const copyZones = [
				header.querySelector('.listing-header-text'),
				header.querySelector('[data-slot="listing-header-stats"]'),
			]
				.filter(Boolean)
				.map((element) => ({
					name: element.matches('.listing-header-text') ? 'title-lede' : 'metrics',
					box: element.getBoundingClientRect(),
				}));

			const parts = [...header.querySelectorAll('[data-blueprint-part]')].map((element) => {
				const box = element.getBoundingClientRect();
				const geometry = relativeRect(box);
				const opacity = Number.parseFloat(getComputedStyle(element).opacity);
				const centerPct = geometry.xPct + geometry.wPct / 2;
				const band = Math.max(0, Math.min(2, Math.floor(centerPct / (100 / 3))));
				const hero = element.hasAttribute('data-blueprint-layer');
				const collisions = [...element.querySelectorAll('text')].flatMap((label) => {
					const labelBox = label.getBoundingClientRect();
					return copyZones
						.filter((zone) => intersects(labelBox, zone.box))
						.map((zone) => ({
							zone: zone.name,
							text: label.textContent?.trim().replace(/\s+/g, ' ') ?? '',
							...relativeRect(labelBox),
						}));
				});

				return {
					part: element.getAttribute('data-blueprint-part'),
					hero,
					...geometry,
					opacity,
					authoredInk: element.style.getPropertyValue('--blueprint-part-ink'),
					band,
					weightedInk: geometry.wPct * geometry.hPct * opacity,
					collisions,
					intersectsCopyZone: copyZones.some((zone) => intersects(box, zone.box)),
				};
			});

			return {
				name: routeName,
				url: pageUrl,
				header: { width: headerBox.width, height: headerBox.height },
				tokens,
				copyZones: copyZones.map((zone) => ({ name: zone.name, ...relativeRect(zone.box) })),
				parts,
			};
		},
		{ headerSelector, routeName: route.name, tokenValues, url },
	);
}

function validate(result) {
	const failures = [];
	for (const [name, expected] of Object.entries(tokenValues)) {
		if (Math.abs(result.tokens[name] - expected) > 0.001) {
			failures.push(`${result.name}: ${name} is ${result.tokens[name]}, expected ${expected}`);
		}
	}

	if (result.parts.length < 10 || result.parts.length > 12) {
		failures.push(`${result.name}: ${result.parts.length} parts, expected 10-12`);
	}

	const details = result.parts.filter((part) => !part.hero);
	const allowedOpacity = Object.values(tokenValues);
	for (const part of details) {
		if (!allowedOpacity.some((value) => Math.abs(part.opacity - value) <= 0.001)) {
			failures.push(`${result.name}/${part.part}: opacity ${part.opacity} is outside the ladder`);
		}
		if (!/^var\(--blueprint-ink-(quiet|mid|accent)\)$/.test(part.authoredInk)) {
			failures.push(`${result.name}/${part.part}: opacity is not authored from the ladder`);
		}
		if (part.opacity > tokenValues['--blueprint-ink-quiet'] && part.intersectsCopyZone) {
			failures.push(`${result.name}/${part.part}: non-quiet part intersects the copy zone`);
		}
	}

	const accentCount = details.filter(
		(part) => Math.abs(part.opacity - tokenValues['--blueprint-ink-accent']) <= 0.001,
	).length;
	if (accentCount > 2) {
		failures.push(`${result.name}: ${accentCount} accent parts, expected at most 2`);
	}

	const roleCounts = { anchor: 0, support: 0, detail: 0 };
	const unclassified = [];
	for (const part of result.parts) {
		if (part.hPct >= 55 && part.hPct <= 75) roleCounts.anchor += 1;
		else if (part.hPct >= 35 && part.hPct <= 50) roleCounts.support += 1;
		else if (part.hPct >= 15 && part.hPct <= 30) roleCounts.detail += 1;
		else unclassified.push(`${part.part} (${round(part.hPct)}%)`);
		if (part.hPct > 100) failures.push(`${result.name}/${part.part}: height exceeds 100%`);
	}
	if (
		roleCounts.anchor !== 2 ||
		roleCounts.support < 4 ||
		roleCounts.support > 5 ||
		roleCounts.detail < 3 ||
		roleCounts.detail > 4 ||
		unclassified.length > 0
	) {
		failures.push(
			`${result.name}: scale roles ${JSON.stringify(roleCounts)}; unclassified ${unclassified.join(', ') || 'none'}`,
		);
	}

	const bandInk = [0, 0, 0];
	for (const part of result.parts) bandInk[part.band] += part.weightedInk;
	const totalInk = bandInk.reduce((sum, value) => sum + value, 0);
	const bandPct = bandInk.map((value) => (value / totalInk) * 100);
	for (const [index, share] of bandPct.entries()) {
		if (share < 25 || share > 40) {
			failures.push(`${result.name}: band ${index + 1} carries ${round(share)}% weighted ink`);
		}
	}

	for (const part of result.parts) {
		for (const collision of part.collisions) {
			failures.push(
				`${result.name}/${part.part}: label "${collision.text}" intersects ${collision.zone}`,
			);
		}
	}

	return {
		failures,
		summary: {
			partCount: result.parts.length,
			roleCounts,
			bandInk: bandInk.map(round),
			bandPct: bandPct.map(round),
			labelCollisions: result.parts.reduce((sum, part) => sum + part.collisions.length, 0),
		},
	};
}

const browser = await chromium.launch({ headless: true });
try {
	const context = await browser.newContext({
		viewport,
		colorScheme: 'dark',
		serviceWorkers: 'block',
	});
	await context.addInitScript(() => localStorage.setItem('theme', 'dark'));
	const page = await context.newPage();
	const pages = [];
	const failures = [];
	for (const route of routes) {
		const result = await measure(page, route);
		const validation = validate(result);
		pages.push({ ...result, summary: validation.summary });
		failures.push(...validation.failures);
	}
	await context.close();

	const receipt = {
		previewUrl: previewUrl.href,
		generatedAt: new Date().toISOString(),
		viewport,
		theme: 'dark',
		routes,
		passed: failures.length === 0,
		failures,
		pages,
	};
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
	if (failures.length > 0) {
		throw new Error(`Blueprint density check failed:\n${failures.join('\n')}`);
	}
} finally {
	await browser.close();
}
