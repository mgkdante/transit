import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture({ archiveSha256 } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'transit-browser-installer-'));
	const installRoot = join(root, 'installed');
	const archiveBody = Buffer.from('authenticated archive');
	const executableBody = Buffer.from('authenticated executable');
	const manifest = {
		schema: 1,
		playwrightCoreVersion: '1.62.0',
		browser: {
			name: 'chromium-headless-shell',
			version: '151.0.7922.34',
			revision: '1234',
			platform: 'linux-x64',
			url: 'https://example.invalid/chromium.zip',
			archiveBytes: archiveBody.length,
			archiveSha256: archiveSha256 ?? sha256(archiveBody),
			archiveRoot: 'chrome-headless-shell-linux64',
			installDirectory: 'chromium_headless_shell-1234',
			executable: 'chrome-headless-shell',
			executableSha256: sha256(executableBody),
		},
	};
	await writeJson(join(root, 'apps/web/package.json'), {
		devDependencies: { 'playwright-core': '1.62.0' },
	});
	await writeJson(join(root, 'apps/web/node_modules/playwright-core/package.json'), {
		version: '1.62.0',
	});
	await writeJson(join(root, 'apps/web/node_modules/playwright-core/browsers.json'), {
		browsers: [
			{
				name: 'chromium-headless-shell',
				revision: '1234',
				installByDefault: true,
				browserVersion: '151.0.7922.34',
			},
		],
	});
	await writeJson(join(root, 'apps/web/browser-toolchain.json'), manifest);
	await mkdir(installRoot, { mode: 0o700 });
	let extracted = false;
	return {
		root,
		installRoot,
		manifest,
		downloadArchive: async ({ destination }) => writeFile(destination, archiveBody),
		listArchive: async () => [
			'chrome-headless-shell-linux64/',
			'chrome-headless-shell-linux64/chrome-headless-shell',
		],
		extractArchive: async ({ destination }) => {
			extracted = true;
			const executable = join(
				destination,
				manifest.browser.archiveRoot,
				manifest.browser.executable,
			);
			await mkdir(dirname(executable), { recursive: true });
			await writeFile(executable, executableBody, { mode: 0o755 });
		},
		wasExtracted: () => extracted,
	};
}

test('authenticates the archive before installing the exact executable and receipt', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		const executable = await installBrowserToolchain({
			repoRoot: subject.root,
			installRoot: subject.installRoot,
			platform: 'linux',
			arch: 'x64',
			env: {},
			downloadArchive: subject.downloadArchive,
			listArchive: subject.listArchive,
			extractArchive: subject.extractArchive,
		});
		assert.equal(
			executable,
			join(
				subject.installRoot,
				'chromium_headless_shell-1234',
				'chrome-headless-shell-linux64',
				'chrome-headless-shell',
			),
		);
		assert.equal(subject.wasExtracted(), true);
		const receipt = JSON.parse(
			await readFile(
				join(subject.installRoot, 'chromium_headless_shell-1234', 'transit-browser-receipt.json'),
				'utf8',
			),
		);
		assert.equal(receipt.archiveSha256, subject.manifest.browser.archiveSha256);
		assert.equal(receipt.archiveBytes, subject.manifest.browser.archiveBytes);
		assert.equal(receipt.executableSha256, subject.manifest.browser.executableSha256);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects a short archive before listing or extraction', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	let listed = false;
	try {
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'linux',
				arch: 'x64',
				env: {},
				downloadArchive: async ({ destination }) => writeFile(destination, 'short'),
				listArchive: async () => {
					listed = true;
					return subject.listArchive();
				},
				extractArchive: subject.extractArchive,
			}),
			/archive byte count mismatch/u,
		);
		assert.equal(listed, false);
		assert.equal(subject.wasExtracted(), false);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects an archive checksum mismatch before extraction', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture({ archiveSha256: '0'.repeat(64) });
	try {
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'linux',
				arch: 'x64',
				env: {},
				downloadArchive: subject.downloadArchive,
				listArchive: subject.listArchive,
				extractArchive: subject.extractArchive,
			}),
			/archive SHA-256 mismatch/u,
		);
		assert.equal(subject.wasExtracted(), false);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects unsafe archive members before extraction', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'linux',
				arch: 'x64',
				env: {},
				downloadArchive: subject.downloadArchive,
				listArchive: async () => ['../escape'],
				extractArchive: subject.extractArchive,
			}),
			/unsafe browser archive member/u,
		);
		assert.equal(subject.wasExtracted(), false);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('fails closed on unsupported platforms and Playwright mirror overrides', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'darwin',
				arch: 'arm64',
				env: {},
			}),
			/unsupported browser artifact platform/u,
		);
		for (const variable of [
			'PLAYWRIGHT_DOWNLOAD_HOST',
			'PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST',
			'PLAYWRIGHT_BROWSERS_PATH',
			'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
		]) {
			await assert.rejects(
				installBrowserToolchain({
					repoRoot: subject.root,
					installRoot: subject.installRoot,
					platform: 'linux',
					arch: 'x64',
					env: { [variable]: '' },
				}),
				/browser environment overrides are not allowed/u,
			);
		}
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects a symlink install parent before downloading', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	const realParent = join(subject.root, 'real-parent');
	const linkedParent = join(subject.root, 'linked-parent');
	let downloaded = false;
	try {
		await mkdir(realParent);
		await symlink(realParent, linkedParent);
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: linkedParent,
				platform: 'linux',
				arch: 'x64',
				env: {},
				downloadArchive: async () => {
					downloaded = true;
				},
			}),
			/browser install root must be a real directory/u,
		);
		assert.equal(downloaded, false);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects extracted symlinks before publishing the install', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	const outside = join(subject.root, 'outside-browser');
	try {
		await writeFile(outside, 'authenticated executable');
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'linux',
				arch: 'x64',
				env: {},
				downloadArchive: subject.downloadArchive,
				listArchive: subject.listArchive,
				extractArchive: async ({ destination }) => {
					const executable = join(
						destination,
						subject.manifest.browser.archiveRoot,
						subject.manifest.browser.executable,
					);
					await mkdir(dirname(executable), { recursive: true });
					await symlink(outside, executable);
				},
			}),
			/browser archive extracted an unsupported file/u,
		);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});
