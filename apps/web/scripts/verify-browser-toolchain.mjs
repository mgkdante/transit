#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyInstalledBrowserArtifact } from './browser-toolchain.mjs';

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

async function launchInstalledBrowser({ executablePath }) {
	const { chromium } = await import('playwright-core');
	return chromium.launch({ headless: true, executablePath });
}

export async function verifyBrowserToolchain({
	repoRoot = DEFAULT_REPO_ROOT,
	browserRoot,
	launchBrowser = launchInstalledBrowser,
} = {}) {
	const artifact = await verifyInstalledBrowserArtifact({ repoRoot, browserRoot });
	const { browser, manifest, paths, webRoot } = artifact;
	const receipt = await readJson(resolve(webRoot, 'static/map/basemap-montreal-posters.json'));

	const declaredPlaywright = requireString(
		manifest.playwrightCoreVersion,
		'playwright-core version',
	);
	const metadataChromium = requireString(browser.version, 'Chromium version');
	const receiptPlaywright = requireString(
		receipt.reproduced_with?.playwright_core_version,
		'poster receipt playwright-core version',
	);
	const receiptChromium = requireString(
		receipt.reproduced_with?.chromium_version,
		'poster receipt Chromium version',
	);
	requireEqual(receiptPlaywright, declaredPlaywright, 'poster receipt playwright-core version');
	requireEqual(receiptChromium, metadataChromium, 'poster receipt Chromium version');

	const launchedBrowser = await launchBrowser({ executablePath: paths.executablePath });
	try {
		const launchedChromium = requireString(launchedBrowser.version(), 'launched Chromium version');
		requireEqual(launchedChromium, metadataChromium, 'launched Chromium version');
	} finally {
		await launchedBrowser.close();
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
