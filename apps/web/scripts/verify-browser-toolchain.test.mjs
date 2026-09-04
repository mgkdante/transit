import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function fixture({ launchedVersion = '151.0.7922.34' } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'transit-browser-toolchain-'));
	const browserRoot = join(root, 'browser');
	const executableBody = 'authenticated chromium executable';
	const executable = join(
		browserRoot,
		'chromium_headless_shell-1234',
		'chrome-headless-shell-linux64',
		'chrome-headless-shell',
	);
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
	await writeJson(join(root, 'apps/web/browser-toolchain.json'), {
		schema: 1,
		playwrightCoreVersion: '1.62.0',
		browser: {
			name: 'chromium-headless-shell',
			version: '151.0.7922.34',
			revision: '1234',
			platform: 'linux-x64',
			url: 'https://example.invalid/chromium.zip',
			archiveBytes: 21,
			archiveSha256: 'a'.repeat(64),
			archiveRoot: 'chrome-headless-shell-linux64',
			installDirectory: 'chromium_headless_shell-1234',
			executable: 'chrome-headless-shell',
			executableSha256: sha256(executableBody),
		},
	});
	await mkdir(dirname(executable), { recursive: true });
	await writeFile(executable, executableBody, { mode: 0o755 });
	await writeFile(join(browserRoot, 'chromium_headless_shell-1234', 'INSTALLATION_COMPLETE'), '');
	await writeJson(
		join(browserRoot, 'chromium_headless_shell-1234', 'transit-browser-receipt.json'),
		{
			schema: 1,
			name: 'chromium-headless-shell',
			version: '151.0.7922.34',
			revision: '1234',
			platform: 'linux-x64',
			archiveBytes: 21,
			archiveSha256: 'a'.repeat(64),
			executableSha256: sha256(executableBody),
		},
	);
	await writeJson(join(root, 'apps/web/static/map/basemap-montreal-posters.json'), {
		reproduced_with: {
			playwright_core_version: '1.62.0',
			chromium_version: '151.0.7922.34',
		},
	});
	await mkdir(join(root, 'apps/web/scripts'), { recursive: true });
	await writeFile(
		join(root, 'apps/web/scripts/build-map-posters.ts'),
		"const PLAYWRIGHT_CORE_VERSION = '1.62.0';\nconst PINNED_CHROMIUM_VERSION = '151.0.7922.34';\n",
	);
	let closed = false;
	let launchedExecutable;
	return {
		root,
		browserRoot,
		executable,
		launchBrowser: async ({ executablePath }) => {
			launchedExecutable = executablePath;
			return {
				version: () => launchedVersion,
				close: async () => {
					closed = true;
				},
			};
		},
		launchedExecutable: () => launchedExecutable,
		wasClosed: () => closed,
	};
}

test('accepts only a consistent package, installed metadata, poster receipt, constants, and browser', async () => {
	const { verifyBrowserToolchain } = await import('./verify-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		const result = await verifyBrowserToolchain({
			repoRoot: subject.root,
			browserRoot: subject.browserRoot,
			launchBrowser: subject.launchBrowser,
		});
		assert.equal(subject.launchedExecutable(), subject.executable);
		assert.deepEqual(result, {
			playwrightVersion: '1.62.0',
			chromiumVersion: '151.0.7922.34',
		});
		assert.equal(subject.wasClosed(), true);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects a launched browser that drifts from installed Playwright metadata', async () => {
	const { verifyBrowserToolchain } = await import('./verify-browser-toolchain.mjs');
	const subject = await fixture({ launchedVersion: '151.0.7922.35' });
	try {
		await assert.rejects(
			verifyBrowserToolchain({
				repoRoot: subject.root,
				browserRoot: subject.browserRoot,
				launchBrowser: subject.launchBrowser,
			}),
			/launched Chromium version mismatch/u,
		);
		assert.equal(subject.wasClosed(), true);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});

test('rejects executable tampering before launching Chromium', async () => {
	const { verifyBrowserToolchain } = await import('./verify-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		await writeFile(subject.executable, 'substituted executable', { mode: 0o755 });
		await assert.rejects(
			verifyBrowserToolchain({
				repoRoot: subject.root,
				browserRoot: subject.browserRoot,
				launchBrowser: subject.launchBrowser,
			}),
			/executable SHA-256 mismatch/u,
		);
		assert.equal(subject.launchedExecutable(), undefined);
		assert.equal(subject.wasClosed(), false);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});
