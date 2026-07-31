import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const WIDTHS = Object.freeze([639, 640, 767, 768, 1023, 1024, 1280]);
export const THEMES = Object.freeze(['dark', 'light']);

const LOCALES = Object.freeze([
	Object.freeze({ locale: 'en', route: '/' }),
	Object.freeze({ locale: 'fr', route: '/fr' }),
]);
const VIEWPORT_HEIGHT = 900;
const DEVICE_SCALE_FACTOR = 1;
const TIMEZONE = 'America/Toronto';
const FROZEN_CLOCK = '2026-07-30T16:00:00.000Z';
const FOOTER_SELECTOR = '[data-testid="footer"]';
const RECEIPT_FILE = 'receipt.json';
const MOTION_KILL_CSS = `
	*, *::before, *::after {
		animation-delay: 0s !important;
		animation-duration: 0s !important;
		animation-iteration-count: 1 !important;
		caret-color: transparent !important;
		scroll-behavior: auto !important;
		transition-delay: 0s !important;
		transition-duration: 0s !important;
	}
`;

function usage() {
	return [
		'Usage:',
		'  node scripts/footer-parity-probe.mjs --base-url <url> --out <empty-directory>',
		'    [--executable-path <chromium-binary>]',
	].join('\n');
}

function parseFlagValues(args) {
	const allowed = new Set(['--base-url', '--out', '--executable-path']);
	const values = new Map();

	for (let index = 0; index < args.length; index++) {
		const flag = args[index];
		if (!allowed.has(flag)) throw new Error(`unknown argument ${JSON.stringify(flag)}\n${usage()}`);
		if (values.has(flag)) throw new Error(`duplicate argument ${flag}`);
		const value = args[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
		values.set(flag, value);
		index++;
	}

	return values;
}

function normalizeBaseUrl(input) {
	let url;
	try {
		url = new URL(input);
	} catch (error) {
		throw new Error(`invalid --base-url ${JSON.stringify(input)}`, { cause: error });
	}
	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new Error(`--base-url must use http or https: ${url.href}`);
	}
	if (url.username || url.password) throw new Error('--base-url must not contain credentials');
	url.hash = '';
	url.search = '';
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url.href;
}

function safeDirectory(input, label) {
	const path = resolve(input);
	if (path === parse(path).root) throw new Error(`${label} must not be a filesystem root`);
	return path;
}

export function parseCliArgs(argv) {
	const values = parseFlagValues(argv);
	const baseUrl = values.get('--base-url');
	const out = values.get('--out');
	if (!baseUrl) throw new Error(`missing --base-url\n${usage()}`);
	if (!out) throw new Error(`missing --out\n${usage()}`);

	const executablePath = values.get('--executable-path');
	return {
		baseUrl: normalizeBaseUrl(baseUrl),
		outDir: safeDirectory(out, '--out'),
		...(executablePath ? { executablePath: resolve(executablePath) } : {}),
	};
}

function scenarioId(width, theme, locale) {
	return `w${String(width).padStart(4, '0')}-${theme}-${locale}`;
}

export function buildScenarioMatrix() {
	return WIDTHS.flatMap((width) =>
		THEMES.flatMap((theme) =>
			LOCALES.map(({ locale, route }) => ({
				id: scenarioId(width, theme, locale),
				width,
				theme,
				locale,
				route,
			})),
		),
	);
}

export function findSystemDateNodeMatch(textNodes) {
	const matches = textNodes.flatMap((text, nodeIndex) =>
		[...text.matchAll(/\b\d{4}\.\d{2}\.\d{2}\b/g)]
			.filter((match) => match.index !== undefined)
			.map((match) => ({ match, nodeIndex })),
	);
	if (matches.length !== 1) {
		throw new Error(`expected exactly one system date, found ${matches.length}`);
	}

	const { match, nodeIndex } = matches[0];
	return {
		nodeIndex,
		start: match.index,
		end: match.index + match[0].length,
		value: match[0],
	};
}

function closeEnough(actual, expected, tolerance) {
	return Math.abs(actual - expected) <= tolerance;
}

export function assertFullBleed(geometry, tolerance = 0.5) {
	const { footer } = geometry;
	for (const key of ['grid', 'statusBar']) {
		const row = geometry[key];
		const matches =
			closeEnough(row.left, footer.left, tolerance) &&
			closeEnough(row.right, footer.right, tolerance) &&
			closeEnough(row.width, footer.width, tolerance);
		if (!matches) {
			throw new Error(
				`${key} is not full bleed: footer=${JSON.stringify(footer)} row=${JSON.stringify(row)}`,
			);
		}
	}
}

function scenarioUrl(baseUrl, route) {
	return new URL(route === '/' ? '.' : route.slice(1), baseUrl).href;
}

async function settle(page) {
	await page.locator(FOOTER_SELECTOR).waitFor({ state: 'visible' });
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise((resolveFrame) =>
			requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
		);
	});
}

async function createContext(browser, scenario) {
	const context = await browser.newContext({
		viewport: { width: scenario.width, height: VIEWPORT_HEIGHT },
		colorScheme: scenario.theme,
		deviceScaleFactor: DEVICE_SCALE_FACTOR,
		timezoneId: TIMEZONE,
		reducedMotion: 'reduce',
	});

	await context.addInitScript(
		({ selectedTheme, frozenEpoch }) => {
			localStorage.setItem('theme', selectedTheme);
			const NativeDate = Date;
			function FrozenDate(...args) {
				if (new.target) {
					return new NativeDate(...(args.length === 0 ? [frozenEpoch] : args));
				}
				return new NativeDate(frozenEpoch).toString();
			}
			Object.setPrototypeOf(FrozenDate, NativeDate);
			FrozenDate.prototype = NativeDate.prototype;
			FrozenDate.now = () => frozenEpoch;
			FrozenDate.parse = NativeDate.parse;
			FrozenDate.UTC = NativeDate.UTC;
			globalThis.Date = FrozenDate;
		},
		{ selectedTheme: scenario.theme, frozenEpoch: Date.parse(FROZEN_CLOCK) },
	);

	return context;
}

async function collectFooterGeometry(page) {
	const collected = await page.evaluate((selector) => {
		const footer = document.querySelector(selector);
		if (!(footer instanceof HTMLElement)) throw new Error('footer landmark not found');
		const footerBox = footer.getBoundingClientRect();
		const rounded = (value) => Math.round(value * 1000) / 1000;
		const relativeRect = (box) => ({
			left: rounded(box.left - footerBox.left),
			top: rounded(box.top - footerBox.top),
			right: rounded(box.right - footerBox.left),
			bottom: rounded(box.bottom - footerBox.top),
			width: rounded(box.width),
			height: rounded(box.height),
		});
		const one = (query) => {
			const matches = footer.querySelectorAll(query);
			if (matches.length !== 1) {
				throw new Error(`expected one ${query} inside footer, found ${matches.length}`);
			}
			return relativeRect(matches[0].getBoundingClientRect());
		};
		const many = (query) =>
			[...footer.querySelectorAll(query)].map((element) =>
				relativeRect(element.getBoundingClientRect()),
			);

		const status = footer.querySelector('.footer-status-border');
		if (!(status instanceof HTMLElement)) throw new Error('footer status bar not found');
		const walker = document.createTreeWalker(status, NodeFilter.SHOW_TEXT);
		const statusTextNodes = [];
		let textNode;
		while ((textNode = walker.nextNode())) statusTextNodes.push(textNode.textContent ?? '');

		const statusStyle = getComputedStyle(status);
		const rootStyle = getComputedStyle(document.documentElement);
		return {
			rects: {
				footer: relativeRect(footerBox),
				hazard: one(':scope > .footer-gradient-sep'),
				grid: one(':scope > .grid'),
				statusBar: relativeRect(status.getBoundingClientRect()),
				wordmark: one('[data-testid="footer-wordmark"]'),
				legalNav: one('[data-testid="footer-legal"]'),
				groupLabels: many('.footer-group-label'),
				links: many('.footer-link'),
			},
			masks: {
				statusDot: one('[data-slot="status-dot"]'),
			},
			statusTextNodes,
			divider: {
				borderTopColor: statusStyle.borderTopColor,
				borderTopStyle: statusStyle.borderTopStyle,
				borderTopWidth: statusStyle.borderTopWidth,
				lineAmber: rootStyle.getPropertyValue('--line-amber').trim(),
			},
			renderContext: {
				theme: document.documentElement.getAttribute('data-theme'),
				locale: document.documentElement.getAttribute('lang')?.split('-')[0] ?? null,
			},
		};
	}, FOOTER_SELECTOR);

	// Validate exactly-one date against the collected snapshot; the Range
	// measurement re-matches IN-PAGE in a single evaluate — hydration can
	// re-split text nodes between evaluates, so a cross-evaluate node index
	// + offset handoff throws IndexSizeError on the re-rendered DOM.
	const dateMatch = findSystemDateNodeMatch(collected.statusTextNodes);
	const systemDate = await page.evaluate(
		({ selector, pattern, expectedValue }) => {
			const footer = document.querySelector(selector);
			if (!(footer instanceof HTMLElement)) throw new Error('footer landmark not found');
			const status = footer.querySelector('.footer-status-border');
			if (!(status instanceof HTMLElement)) throw new Error('footer status bar not found');
			const walker = document.createTreeWalker(status, NodeFilter.SHOW_TEXT);
			const matches = [];
			let candidate;
			while ((candidate = walker.nextNode())) {
				for (const found of (candidate.textContent ?? '').matchAll(new RegExp(pattern, 'g'))) {
					matches.push({
						node: candidate,
						start: found.index,
						end: found.index + found[0].length,
						value: found[0],
					});
				}
			}
			if (matches.length !== 1) {
				throw new Error(`expected exactly one system date in-page, found ${matches.length}`);
			}
			const { node, start, end, value } = matches[0];
			if (value !== expectedValue) {
				throw new Error(`in-page date ${value} != collected ${expectedValue}`);
			}

			const range = document.createRange();
			range.setStart(node, start);
			range.setEnd(node, end);
			const footerBox = footer.getBoundingClientRect();
			const box = range.getBoundingClientRect();
			const rounded = (value) => Math.round(value * 1000) / 1000;
			return {
				left: rounded(box.left - footerBox.left),
				top: rounded(box.top - footerBox.top),
				right: rounded(box.right - footerBox.left),
				bottom: rounded(box.bottom - footerBox.top),
				width: rounded(box.width),
				height: rounded(box.height),
			};
		},
		{
			selector: FOOTER_SELECTOR,
			pattern: '\\b\\d{4}\\.\\d{2}\\.\\d{2}\\b',
			expectedValue: dateMatch.value,
		},
	);

	const { statusTextNodes: _statusTextNodes, ...geometry } = collected;
	const result = {
		...geometry,
		masks: {
			statusDot: geometry.masks.statusDot,
			systemDate,
		},
	};
	assertFullBleed({
		footer: result.rects.footer,
		grid: result.rects.grid,
		statusBar: result.rects.statusBar,
	});
	return result;
}

async function captureScenario(browser, args, scenario) {
	const context = await createContext(browser, scenario);
	const page = await context.newPage();
	try {
		const url = scenarioUrl(args.baseUrl, scenario.route);
		const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
		if (!response?.ok()) {
			throw new Error(`navigation failed (${response?.status() ?? 'no response'}): ${url}`);
		}
		await page.addStyleTag({ content: MOTION_KILL_CSS });
		await settle(page);

		const footer = page.locator(FOOTER_SELECTOR);
		await footer.scrollIntoViewIfNeeded();
		await settle(page);
		const geometry = await collectFooterGeometry(page);
		const screenshotFile = `${scenario.id}.png`;
		const screenshot = await footer.screenshot({
			path: join(args.outDir, screenshotFile),
			animations: 'disabled',
			caret: 'hide',
		});

		return {
			...scenario,
			url: page.url(),
			screenshot: {
				file: screenshotFile,
				sha256: createHash('sha256').update(screenshot).digest('hex'),
				bytes: screenshot.byteLength,
			},
			...geometry,
		};
	} finally {
		await context.close();
	}
}

function prepareOutputDirectory(outDir) {
	if (existsSync(outDir)) {
		if (!statSync(outDir).isDirectory()) throw new Error(`output is not a directory: ${outDir}`);
		if (readdirSync(outDir).length > 0) {
			throw new Error(`output directory must be empty: ${outDir}`);
		}
		return;
	}
	mkdirSync(outDir, { recursive: true });
}

async function runProbe(args) {
	prepareOutputDirectory(args.outDir);
	const executablePath =
		args.executablePath ??
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
		process.env.CHROMIUM_EXECUTABLE_PATH;
	const browser = await chromium.launch({
		headless: true,
		...(executablePath ? { executablePath } : {}),
	});

	try {
		const captures = [];
		for (const scenario of buildScenarioMatrix()) {
			captures.push(await captureScenario(browser, args, scenario));
		}
		const receipt = {
			schemaVersion: 1,
			kind: 'transit-footer-parity-probe',
			baseUrl: args.baseUrl,
			generatedAt: new Date().toISOString(),
			config: {
				widths: WIDTHS,
				themes: THEMES,
				locales: LOCALES,
				viewportHeight: VIEWPORT_HEIGHT,
				deviceScaleFactor: DEVICE_SCALE_FACTOR,
				timezone: TIMEZONE,
				frozenClock: FROZEN_CLOCK,
				reducedMotion: 'reduce',
				motionKillCss: true,
				maskKeys: ['statusDot', 'systemDate'],
			},
			captures,
		};
		const receiptPath = join(args.outDir, RECEIPT_FILE);
		writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
		process.stdout.write(`${receiptPath}\n`);
	} finally {
		await browser.close();
	}
}

export async function main(argv = process.argv.slice(2)) {
	await runProbe(parseCliArgs(argv));
}

const isMain =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	void main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	});
}
