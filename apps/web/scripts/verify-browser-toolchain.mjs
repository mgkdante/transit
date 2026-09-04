#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

function requireString(value, label) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function requireEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
	}
}

function sourceConstant(source, name) {
	const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`, 'u'));
	if (!match) throw new Error(`${name} is missing from build-map-posters.ts`);
	return match[1];
}

async function launchInstalledBrowser() {
	const { chromium } = await import('playwright-core');
	return chromium.launch({ headless: true });
}

export async function verifyBrowserToolchain({
	repoRoot = DEFAULT_REPO_ROOT,
	launchBrowser = launchInstalledBrowser,
} = {}) {
	const webRoot = resolve(repoRoot, 'apps/web');
	const [webPackage, installedPackage, browsers, receipt, posterSource] = await Promise.all([
		readJson(resolve(webRoot, 'package.json')),
		readJson(resolve(webRoot, 'node_modules/playwright-core/package.json')),
		readJson(resolve(webRoot, 'node_modules/playwright-core/browsers.json')),
		readJson(resolve(webRoot, 'static/map/basemap-montreal-posters.json')),
		readFile(resolve(webRoot, 'scripts/build-map-posters.ts'), 'utf8'),
	]);

	const declaredPlaywright = requireString(
		webPackage.devDependencies?.['playwright-core'],
		'package playwright-core version',
	);
	const installedPlaywright = requireString(
		installedPackage.version,
		'installed playwright-core version',
	);
	const metadata = browsers.browsers?.find(
		(browser) => browser?.name === 'chromium-headless-shell' && browser.installByDefault === true,
	);
	if (!metadata) {
		throw new Error('installed Playwright metadata is missing chromium-headless-shell');
	}
	const metadataChromium = requireString(
		metadata.browserVersion,
		'installed Chromium metadata version',
	);
	const receiptPlaywright = requireString(
		receipt.reproduced_with?.playwright_core_version,
		'poster receipt playwright-core version',
	);
	const receiptChromium = requireString(
		receipt.reproduced_with?.chromium_version,
		'poster receipt Chromium version',
	);
	const constantPlaywright = sourceConstant(posterSource, 'PLAYWRIGHT_CORE_VERSION');
	const constantChromium = sourceConstant(posterSource, 'PINNED_CHROMIUM_VERSION');

	requireEqual(installedPlaywright, declaredPlaywright, 'installed playwright-core version');
	requireEqual(receiptPlaywright, declaredPlaywright, 'poster receipt playwright-core version');
	requireEqual(constantPlaywright, declaredPlaywright, 'poster playwright-core constant');
	requireEqual(receiptChromium, metadataChromium, 'poster receipt Chromium version');
	requireEqual(constantChromium, metadataChromium, 'poster Chromium constant');

	const browser = await launchBrowser();
	try {
		const launchedChromium = requireString(browser.version(), 'launched Chromium version');
		requireEqual(launchedChromium, metadataChromium, 'launched Chromium version');
	} finally {
		await browser.close();
	}

	return {
		playwrightVersion: declaredPlaywright,
		chromiumVersion: metadataChromium,
	};
}

async function main() {
	const result = await verifyBrowserToolchain();
	process.stdout.write(
		`Browser toolchain verified: playwright-core ${result.playwrightVersion}, Chromium ${result.chromiumVersion}\n`,
	);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
