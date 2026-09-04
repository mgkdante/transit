import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture({ launchedVersion = '151.0.7922.34' } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'transit-browser-toolchain-'));
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
	return {
		root,
		launchBrowser: async () => ({
			version: () => launchedVersion,
			close: async () => {
				closed = true;
			},
		}),
		wasClosed: () => closed,
	};
}

test('accepts only a consistent package, installed metadata, poster receipt, constants, and browser', async () => {
	const { verifyBrowserToolchain } = await import('./verify-browser-toolchain.mjs');
	const subject = await fixture();
	try {
		const result = await verifyBrowserToolchain({
			repoRoot: subject.root,
			launchBrowser: subject.launchBrowser,
		});
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
				launchBrowser: subject.launchBrowser,
			}),
			/launched Chromium version mismatch/u,
		);
		assert.equal(subject.wasClosed(), true);
	} finally {
		await rm(subject.root, { recursive: true, force: true });
	}
});
