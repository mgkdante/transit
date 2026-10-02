import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execFile = promisify(execFileCallback);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture({ archiveSha256, platform = 'linux-x64' } = {}) {
	const root = await mkdtemp(join(tmpdir(), "transit browser's installer-"));
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
			installDirectory: 'chromium_headless_shell-1234',
			platform,
			url: 'https://example.invalid/chromium.zip',
			archiveBytes: archiveBody.length,
			archiveSha256: archiveSha256 ?? sha256(archiveBody),
			archiveRoot:
				platform === 'win32-x64' ? 'chrome-headless-shell-win64' : 'chrome-headless-shell-linux64',
			executable: platform === 'win32-x64' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell',
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
	await writeJson(
		join(
			root,
			'apps/web',
			platform === 'win32-x64' ? 'browser-toolchain.win32-x64.json' : 'browser-toolchain.json',
		),
		manifest,
	);
	await mkdir(installRoot, { mode: 0o700 });
	let extracted = false;
	const browser = manifest.browser;
	return {
		root,
		installRoot,
		manifest,
		browser,
		downloadArchive: async ({ destination }) => writeFile(destination, archiveBody),
		listArchive: async () => [
			`${browser.archiveRoot}/`,
			`${browser.archiveRoot}/${browser.executable}`,
		],
		extractArchive: async ({ destination }) => {
			extracted = true;
			const executable = join(destination, browser.archiveRoot, browser.executable);
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
		assert.equal(receipt.schema, 1);
		assert.equal(receipt.platform, 'linux-x64');
		assert.equal(receipt.archiveSha256, subject.browser.archiveSha256);
		assert.equal(receipt.archiveBytes, subject.browser.archiveBytes);
		assert.equal(receipt.executableSha256, subject.browser.executableSha256);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('selects and authenticates the Windows artifact with a schema 1 platform receipt', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture({ platform: 'win32-x64' });
	try {
		const executable = await installBrowserToolchain({
			repoRoot: subject.root,
			installRoot: subject.installRoot,
			platform: 'win32',
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
				'chrome-headless-shell-win64',
				'chrome-headless-shell.exe',
			),
		);
		const receipt = JSON.parse(
			await readFile(
				join(subject.installRoot, 'chromium_headless_shell-1234', 'transit-browser-receipt.json'),
				'utf8',
			),
		);
		assert.equal(receipt.schema, 1);
		assert.equal(receipt.platform, 'win32-x64');
		assert.equal(receipt.executableSha256, subject.browser.executableSha256);
		assert.deepEqual(await readdir(subject.installRoot), ['chromium_headless_shell-1234']);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('downloads only HTTPS without following redirects and authenticates the declared length', async () => {
	const { downloadBrowserArchive } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		await assert.rejects(
			downloadBrowserArchive({
				url: 'http://example.invalid/browser.zip',
				destination: join(subject.root, 'http.zip'),
				archiveBytes: 3,
				fetchArchive: async () => {
					throw new Error('must not fetch HTTP');
				},
			}),
			/must use HTTPS/u,
		);
		const destination = join(subject.root, 'valid.zip');
		await downloadBrowserArchive({
			url: 'https://example.invalid/browser.zip',
			destination,
			archiveBytes: 3,
			fetchArchive: async (url, options) => {
				assert.equal(url, 'https://example.invalid/browser.zip');
				assert.equal(options.redirect, 'error');
				assert.equal(options.signal.aborted, false);
				return new Response('zip', { headers: { 'content-length': '3' } });
			},
		});
		assert.equal(await readFile(destination, 'utf8'), 'zip');
		for (const response of [
			new Response('error', { status: 503 }),
			new Response(null, { status: 302 }),
			new Response('zip', { headers: { 'content-length': '4' } }),
		]) {
			await assert.rejects(
				downloadBrowserArchive({
					url: 'https://example.invalid/browser.zip',
					destination: join(subject.root, 'rejected.zip'),
					archiveBytes: 3,
					fetchArchive: async () => response,
				}),
				/HTTP|Content-Length mismatch/u,
			);
		}
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('caps streamed download bytes and aborts stalled transport', async () => {
	const { downloadBrowserArchive } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		await assert.rejects(
			downloadBrowserArchive({
				url: 'https://example.invalid/browser.zip',
				destination: join(subject.root, 'oversized.zip'),
				archiveBytes: 3,
				fetchArchive: async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new Uint8Array([1, 2]));
								controller.enqueue(new Uint8Array([3, 4]));
								controller.close();
							},
						}),
					),
			}),
			/exceeds pinned byte count/u,
		);
		await assert.rejects(
			downloadBrowserArchive({
				url: 'https://example.invalid/browser.zip',
				destination: join(subject.root, 'stalled.zip'),
				archiveBytes: 3,
				timeoutMs: 10,
				fetchArchive: async (_url, { signal }) => {
					await delay(1_000, undefined, { signal });
					return new Response('zip');
				},
			}),
			/aborted/u,
		);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('removes partial streamed downloads from installation staging', async () => {
	const { downloadBrowserArchive, installBrowserToolchain } =
		await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'linux',
				arch: 'x64',
				env: {},
				downloadArchive: (options) =>
					downloadBrowserArchive({
						...options,
						fetchArchive: async () =>
							new Response(
								new ReadableStream({
									start(controller) {
										controller.enqueue(new Uint8Array([1, 2]));
										controller.error(new Error('injected response stream failure'));
									},
								}),
							),
					}),
			}),
			/injected response stream failure/u,
		);
		assert.deepEqual(await readdir(subject.installRoot), []);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects Windows path aliases and case-insensitive duplicate members before extraction', async () => {
	const { validateBrowserArchiveEntries } = await import('./install-browser-toolchain.mjs');
	const browser = {
		platform: 'win32-x64',
		archiveRoot: 'chrome-headless-shell-win64',
		executable: 'chrome-headless-shell.exe',
	};
	const executable = 'chrome-headless-shell-win64/chrome-headless-shell.exe';
	for (const member of [
		'chrome-headless-shell-win64/file:stream',
		'chrome-headless-shell-win64/CON.txt',
		'chrome-headless-shell-win64/nul',
		'chrome-headless-shell-win64/COM1.log',
		'chrome-headless-shell-win64/filename.',
		'chrome-headless-shell-win64/filename ',
		'chrome-headless-shell-win64/file?.txt',
	]) {
		assert.throws(
			() => validateBrowserArchiveEntries([executable, member], browser),
			/unsafe browser archive member/u,
			member,
		);
	}
	assert.throws(
		() =>
			validateBrowserArchiveEntries(
				[executable, 'chrome-headless-shell-win64/CHROME-HEADLESS-SHELL.EXE'],
				browser,
			),
		/duplicate browser archive member/u,
	);
	assert.throws(
		() => validateBrowserArchiveEntries([executable, executable], browser),
		/duplicate browser archive member/u,
	);
});

test('cleans staging after download, member listing, extraction, or executable authentication fails', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	for (const failure of ['download', 'list', 'extract', 'executable']) {
		const subject = await fixture();
		try {
			await assert.rejects(
				installBrowserToolchain({
					repoRoot: subject.root,
					installRoot: subject.installRoot,
					platform: 'linux',
					arch: 'x64',
					env: {},
					downloadArchive:
						failure === 'download'
							? async ({ destination }) => {
									await writeFile(destination, 'partial');
									throw new Error('injected download failure');
								}
							: subject.downloadArchive,
					listArchive:
						failure === 'list'
							? async () => {
									throw new Error('injected listing failure');
								}
							: subject.listArchive,
					extractArchive: async ({ destination }) => {
						await subject.extractArchive({ destination });
						if (failure === 'extract') throw new Error('injected extraction failure');
						if (failure === 'executable')
							await writeFile(
								join(destination, subject.browser.archiveRoot, subject.browser.executable),
								'tampered executable',
							);
					},
				}),
				/injected|executable SHA-256 mismatch/u,
			);
			assert.deepEqual(await readdir(subject.installRoot), [], failure);
		} finally {
			await rm(subject.root, { recursive: true, force: true });
		}
	}
});

test('refuses an existing install target before downloading', async () => {
	const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		const target = join(subject.installRoot, 'chromium_headless_shell-1234');
		await mkdir(target);
		await writeFile(join(target, 'preserved'), 'existing installation');
		await assert.rejects(
			installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'linux',
				arch: 'x64',
				env: {},
				downloadArchive: async () => {
					throw new Error('must not download');
				},
			}),
			/install target already exists/u,
		);
		assert.equal(await readFile(join(target, 'preserved'), 'utf8'), 'existing installation');
		assert.deepEqual(await readdir(subject.installRoot), ['chromium_headless_shell-1234']);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test(
	'uses the native Windows ZIP boundary for paths containing spaces and apostrophes',
	{ skip: process.platform !== 'win32' },
	async () => {
		const { installBrowserToolchain } = await import('./install-browser-toolchain.mjs');
		const subject = await fixture({ platform: 'win32-x64' });
		try {
			const source = join(subject.root, 'zip-source');
			await subject.extractArchive({ destination: source });
			const archive = join(subject.root, 'synthetic.zip');
			const script =
				"Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::Open($env:TRANSIT_TEST_ZIP_ARCHIVE, 'Create'); try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, [IO.Path]::Combine($env:TRANSIT_TEST_ZIP_SOURCE, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), 'chrome-headless-shell-win64/chrome-headless-shell.exe') | Out-Null } finally { $zip.Dispose() }";
			await execFile(
				'powershell.exe',
				[
					'-NoProfile',
					'-NonInteractive',
					'-EncodedCommand',
					Buffer.from(script, 'utf16le').toString('base64'),
				],
				{
					windowsHide: true,
					timeout: 30_000,
					env: {
						...process.env,
						TRANSIT_TEST_ZIP_SOURCE: source,
						TRANSIT_TEST_ZIP_ARCHIVE: archive,
					},
				},
			);
			const bytes = await readFile(archive);
			subject.browser.archiveBytes = bytes.length;
			subject.browser.archiveSha256 = sha256(bytes);
			await writeJson(
				join(subject.root, 'apps/web/browser-toolchain.win32-x64.json'),
				subject.manifest,
			);
			const executable = await installBrowserToolchain({
				repoRoot: subject.root,
				installRoot: subject.installRoot,
				platform: 'win32',
				arch: 'x64',
				env: {},
				downloadArchive: async ({ destination }) => writeFile(destination, bytes),
			});
			assert.equal(await readFile(executable, 'utf8'), 'authenticated executable');
			assert.deepEqual(await readdir(subject.installRoot), ['chromium_headless_shell-1234']);
		} finally {
			await rm(subject.root, { recursive: true, force: true });
		}
	},
);

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
		await symlink(realParent, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
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
		await mkdir(outside);
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
					const executable = join(destination, subject.browser.archiveRoot);
					await mkdir(dirname(executable), { recursive: true });
					await symlink(outside, executable, process.platform === 'win32' ? 'junction' : 'dir');
				},
			}),
			/browser archive extracted an unsupported file/u,
		);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});
