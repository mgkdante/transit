#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
	browserPlatform,
	readBrowserToolchain,
	resolveBrowserArtifact,
	sha256File,
} from './browser-toolchain.mjs';

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const execFile = promisify(execFileCallback);
const DOWNLOAD_HOST_OVERRIDES = [
	'PLAYWRIGHT_DOWNLOAD_HOST',
	'PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST',
	'PLAYWRIGHT_BROWSERS_PATH',
	'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
];

async function pathExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

async function downloadWithCurl({ url, destination, archiveBytes }) {
	await execFile(
		'/usr/bin/curl',
		[
			'--fail',
			'--silent',
			'--show-error',
			'--proto',
			'=https',
			'--max-filesize',
			String(archiveBytes),
			'--output',
			destination,
			url,
		],
		{ timeout: 180_000 },
	);
}

async function listWithUnzip({ archive }) {
	const { stdout } = await execFile('/usr/bin/unzip', ['-Z1', archive], {
		maxBuffer: 2 * 1024 * 1024,
	});
	return stdout.split(/\r?\n/u).filter(Boolean);
}

async function extractWithUnzip({ archive, destination }) {
	await execFile('/usr/bin/unzip', ['-q', archive, '-d', destination], { timeout: 180_000 });
}

async function verifyExtractedTree(root) {
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			const details = await lstat(path);
			if (details.isSymbolicLink() || (!details.isDirectory() && !details.isFile())) {
				throw new Error(`browser archive extracted an unsupported file: ${path}`);
			}
			if (details.isDirectory()) pending.push(path);
		}
	}
}

export function validateBrowserArchiveEntries(entries, browser) {
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new Error('browser archive has no members');
	}
	const executableMember = `${browser.archiveRoot}/${browser.executable}`;
	let executableCount = 0;
	for (const entry of entries) {
		const member = entry.endsWith('/') ? entry.slice(0, -1) : entry;
		const parts = member.split('/');
		if (
			!member ||
			entry.startsWith('/') ||
			entry.includes('\\') ||
			parts.some(
				(part) =>
					!part ||
					part === '.' ||
					part === '..' ||
					[...part].some((character) => character <= '\u001f' || character === '\u007f'),
			) ||
			parts[0] !== browser.archiveRoot
		) {
			throw new Error(`unsafe browser archive member: ${JSON.stringify(entry)}`);
		}
		if (member === executableMember) executableCount += 1;
	}
	if (executableCount !== 1) {
		throw new Error(`browser archive must contain exactly one ${executableMember}`);
	}
}

export async function installBrowserToolchain({
	repoRoot = DEFAULT_REPO_ROOT,
	installRoot,
	platform = process.platform,
	arch = process.arch,
	env = process.env,
	downloadArchive = downloadWithCurl,
	listArchive = listWithUnzip,
	extractArchive = extractWithUnzip,
} = {}) {
	if (typeof installRoot !== 'string' || !isAbsolute(installRoot)) {
		throw new Error('browser install root must be an absolute path');
	}
	const selectedPlatform = browserPlatform(platform, arch);
	for (const variable of DOWNLOAD_HOST_OVERRIDES) {
		if (Object.hasOwn(env, variable)) {
			throw new Error('Playwright browser environment overrides are not allowed');
		}
	}
	const { browser } = await readBrowserToolchain({ repoRoot });
	if (browser.platform !== selectedPlatform) {
		throw new Error(
			`unsupported browser artifact platform: manifest has ${browser.platform}, host is ${selectedPlatform}`,
		);
	}
	const paths = resolveBrowserArtifact({ repoRoot, browserRoot: installRoot, browser });
	if (await pathExists(paths.targetDirectory)) {
		throw new Error(`browser install target already exists: ${paths.targetDirectory}`);
	}
	const installRootStat = await lstat(paths.installRoot);
	if (!installRootStat.isDirectory() || installRootStat.isSymbolicLink()) {
		throw new Error('browser install root must be a real directory');
	}

	const workDirectory = await mkdtemp(join(paths.installRoot, '.transit-browser-install-'));
	try {
		const archive = join(workDirectory, 'browser.zip');
		const stagedTarget = join(workDirectory, browser.installDirectory);
		await downloadArchive({
			url: browser.url,
			destination: archive,
			archiveBytes: browser.archiveBytes,
		});
		const archiveStat = await lstat(archive);
		if (
			!archiveStat.isFile() ||
			archiveStat.isSymbolicLink() ||
			archiveStat.size !== browser.archiveBytes
		) {
			throw new Error(
				`browser archive byte count mismatch: expected ${browser.archiveBytes}, got ${archiveStat.size}`,
			);
		}
		const actualArchiveSha256 = await sha256File(archive);
		if (actualArchiveSha256 !== browser.archiveSha256) {
			throw new Error(
				`browser archive SHA-256 mismatch: expected ${browser.archiveSha256}, got ${actualArchiveSha256}`,
			);
		}
		const entries = await listArchive({ archive });
		validateBrowserArchiveEntries(entries, browser);
		await mkdir(stagedTarget, { mode: 0o755 });
		await extractArchive({ archive, destination: stagedTarget });
		await verifyExtractedTree(stagedTarget);

		const extractedDirectory = resolve(stagedTarget, browser.archiveRoot);
		const extractedExecutable = resolve(extractedDirectory, browser.executable);
		const [directoryStat, executableStat] = await Promise.all([
			lstat(extractedDirectory),
			lstat(extractedExecutable),
		]);
		if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
			throw new Error('extracted browser root must be a real directory');
		}
		if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
			throw new Error('extracted browser executable must be a regular file');
		}
		const actualExecutableSha256 = await sha256File(extractedExecutable);
		if (actualExecutableSha256 !== browser.executableSha256) {
			throw new Error(
				`browser executable SHA-256 mismatch: expected ${browser.executableSha256}, got ${actualExecutableSha256}`,
			);
		}
		await chmod(extractedExecutable, 0o755);
		await writeFile(
			resolve(stagedTarget, 'transit-browser-receipt.json'),
			`${JSON.stringify(
				{
					schema: 1,
					name: browser.name,
					version: browser.version,
					revision: browser.revision,
					platform: browser.platform,
					archiveBytes: browser.archiveBytes,
					archiveSha256: browser.archiveSha256,
					executableSha256: browser.executableSha256,
				},
				null,
				2,
			)}\n`,
			{ mode: 0o644 },
		);
		await writeFile(resolve(stagedTarget, 'INSTALLATION_COMPLETE'), '', { mode: 0o644 });
		await mkdir(dirname(paths.targetDirectory), { recursive: true, mode: 0o755 });
		await rename(stagedTarget, paths.targetDirectory);
		return paths.executablePath;
	} finally {
		await rm(workDirectory, { recursive: true, force: true });
	}
}

async function main() {
	const [installRoot, ...extra] = process.argv.slice(2);
	if (!installRoot || extra.length > 0) {
		throw new Error('usage: install-browser-toolchain.mjs ABSOLUTE_INSTALL_ROOT');
	}
	const executable = await installBrowserToolchain({ installRoot });
	process.stdout.write(`${executable}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
