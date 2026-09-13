import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RECEIPT_NAME = 'transit-browser-receipt.json';
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_COMPONENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u;

/**
 * @typedef {{
 *   name: string,
 *   version: string,
 *   revision: string,
 *   platform: string,
 *   url: string,
 *   archiveBytes: number,
 *   archiveSha256: string,
 *   archiveRoot: string,
 *   installDirectory: string,
 *   executable: string,
 *   executableSha256: string,
 * }} BrowserContract
 */

/** @param {string} path @param {string} label @returns {Promise<any>} */
async function readJson(path, label) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`cannot read ${label}: ${error instanceof Error ? error.message : error}`, {
			cause: error,
		});
	}
}

/** @param {unknown} actual @param {unknown} expected @param {string} label */
function requireEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
	}
}

/** @param {unknown} value @param {string} label @returns {string} */
function requireSafeComponent(value, label) {
	if (typeof value !== 'string' || !SAFE_COMPONENT.test(value) || value === '.' || value === '..') {
		throw new Error(`${label} must be one safe path component`);
	}
	return value;
}

export function browserPlatform(platform = process.platform, arch = process.arch) {
	if (platform === 'linux' && arch === 'x64') return 'linux-x64';
	throw new Error(`unsupported browser artifact platform: ${platform}-${arch}`);
}

/** @param {string} path */
export async function sha256File(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

/** @param {{ repoRoot?: string }} [options] */
export async function readBrowserToolchain({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
	const webRoot = resolve(repoRoot, 'apps/web');
	const [manifest, webPackage, installedPackage, browsers] = await Promise.all([
		readJson(resolve(webRoot, 'browser-toolchain.json'), 'browser-toolchain.json'),
		readJson(resolve(webRoot, 'package.json'), 'apps/web/package.json'),
		readJson(
			resolve(webRoot, 'node_modules/playwright-core/package.json'),
			'installed playwright-core package',
		),
		readJson(
			resolve(webRoot, 'node_modules/playwright-core/browsers.json'),
			'installed Playwright browser metadata',
		),
	]);

	requireEqual(manifest.schema, 1, 'browser toolchain schema');
	const browser = manifest.browser;
	if (!browser || typeof browser !== 'object')
		throw new Error('browser toolchain entry is missing');
	for (const [key, value] of [
		['name', browser.name],
		['version', browser.version],
		['revision', browser.revision],
		['platform', browser.platform],
	]) {
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`browser ${key} must be a non-empty string`);
		}
	}
	for (const [key, value] of [
		['archiveRoot', browser.archiveRoot],
		['installDirectory', browser.installDirectory],
		['executable', browser.executable],
	]) {
		requireSafeComponent(value, `browser ${key}`);
	}
	for (const [key, value] of [
		['archive SHA-256', browser.archiveSha256],
		['executable SHA-256', browser.executableSha256],
	]) {
		if (typeof value !== 'string' || !SHA256.test(value)) {
			throw new Error(`browser ${key} must be a lowercase SHA-256`);
		}
	}
	const url = new URL(browser.url);
	if (url.protocol !== 'https:') throw new Error('browser artifact URL must use HTTPS');
	if (!Number.isSafeInteger(browser.archiveBytes) || browser.archiveBytes <= 0) {
		throw new Error('browser archiveBytes must be a positive integer');
	}

	const declaredPlaywright = webPackage.devDependencies?.['playwright-core'];
	requireEqual(
		declaredPlaywright,
		manifest.playwrightCoreVersion,
		'declared playwright-core version',
	);
	requireEqual(
		installedPackage.version,
		manifest.playwrightCoreVersion,
		'installed playwright-core version',
	);
	const metadata = browsers.browsers?.find(
		(/** @type {Record<string, unknown>} */ entry) =>
			entry?.name === browser.name && entry.installByDefault === true,
	);
	if (!metadata) throw new Error(`installed Playwright metadata is missing ${browser.name}`);
	requireEqual(metadata.browserVersion, browser.version, 'installed Chromium metadata version');
	requireEqual(String(metadata.revision), browser.revision, 'installed Chromium metadata revision');

	return { browser, manifest, metadata, webRoot };
}

/**
 * @param {{ repoRoot?: string, browserRoot?: string, browser?: BrowserContract }} [options]
 */
export function resolveBrowserArtifact({
	repoRoot = DEFAULT_REPO_ROOT,
	browserRoot,
	browser,
} = {}) {
	if (!browser) throw new Error('browser toolchain entry is required');
	const selectedRoot = browserRoot ?? process.env.TRANSIT_BROWSER_ROOT;
	const installRoot = selectedRoot
		? resolve(selectedRoot)
		: resolve(repoRoot, '.cache/transit-browser');
	if (selectedRoot && !isAbsolute(selectedRoot)) {
		throw new Error('TRANSIT_BROWSER_ROOT must be an absolute path');
	}
	const targetDirectory = resolve(installRoot, browser.installDirectory);
	const executablePath = resolve(targetDirectory, browser.archiveRoot, browser.executable);
	return {
		installRoot,
		targetDirectory,
		executablePath,
		markerPath: resolve(targetDirectory, 'INSTALLATION_COMPLETE'),
		receiptPath: resolve(targetDirectory, RECEIPT_NAME),
	};
}

/** @param {{ repoRoot?: string, browserRoot?: string }} [options] */
export async function verifyInstalledBrowserArtifact({
	repoRoot = DEFAULT_REPO_ROOT,
	browserRoot,
} = {}) {
	const { browser, manifest, metadata, webRoot } = await readBrowserToolchain({ repoRoot });
	const paths = resolveBrowserArtifact({ repoRoot, browserRoot, browser });
	const [targetStat, executableStat, markerStat, receiptStat, receipt] = await Promise.all([
		lstat(paths.targetDirectory),
		lstat(paths.executablePath),
		lstat(paths.markerPath),
		lstat(paths.receiptPath),
		readJson(paths.receiptPath, 'browser installation receipt'),
	]);
	if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
		throw new Error('browser install directory must be a real directory');
	}
	if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
		throw new Error('browser executable must be a regular file');
	}
	if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
		throw new Error('browser installation marker must be a regular file');
	}
	if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) {
		throw new Error('browser receipt must be a regular file');
	}
	const [realTarget, realExecutable] = await Promise.all([
		realpath(paths.targetDirectory),
		realpath(paths.executablePath),
	]);
	const escaped = relative(realTarget, realExecutable);
	if (escaped.startsWith('..') || isAbsolute(escaped)) {
		throw new Error('browser executable escapes its install directory');
	}

	for (const [key, expected] of [
		['schema', 1],
		['name', browser.name],
		['version', browser.version],
		['revision', browser.revision],
		['platform', browser.platform],
		['archiveBytes', browser.archiveBytes],
		['archiveSha256', browser.archiveSha256],
		['executableSha256', browser.executableSha256],
	]) {
		requireEqual(receipt[key], expected, `browser receipt ${key}`);
	}
	const actualExecutableSha256 = await sha256File(paths.executablePath);
	requireEqual(actualExecutableSha256, browser.executableSha256, 'browser executable SHA-256');
	return { browser, manifest, metadata, paths, webRoot };
}
