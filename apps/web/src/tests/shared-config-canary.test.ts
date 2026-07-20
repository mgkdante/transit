import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import webConfig from '../../svelte.config.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONFIG_URL =
	'https://github.com/mgkdante/yesid.dev-design/releases/download/config-v0.2.0/yesid-config-v0.2.0.tgz';
const CONFIG_LOCK_INTEGRITY =
	'sha512-UOP1BG2JaV88/EqrA2mmtlymrLV3OTOIeDqMAdZysySycERKE3OUK0oApKK1udQhGEZcMHd2xnuxNFY7gO5OnA==';
const CONFIG_BASE_DIGEST = '588a4acf72f44593561112fc945d410548b56cf556bbbc9bc745c1f7b218424f';
const MATERIALIZED_BASE = 'node_modules/.yesid-shared-tooling/turbo/base.json';
const TRANSIT_TURBO_SEMANTIC_DIGEST =
	'63ce5a66e904347e49bdfa8050d868e2c7672dc80b4893e91869b92e516cdfed';

type JsonObject = Record<string, unknown>;

function text(path: string): string {
	return readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
}

function json(path: string): JsonObject {
	return JSON.parse(text(path)) as JsonObject;
}

function jsonc(path: string): JsonObject {
	return JSON.parse(text(path).replace(/^\s*\/\/.*$/gmu, '')) as JsonObject;
}

function sha256(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalize((value as JsonObject)[key])]),
		);
	}
	return value;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function mergeJson(base: unknown, overlay: unknown): unknown {
	if (
		base === null ||
		overlay === null ||
		typeof base !== 'object' ||
		typeof overlay !== 'object' ||
		Array.isArray(base) ||
		Array.isArray(overlay)
	) {
		return structuredClone(overlay);
	}
	const result = structuredClone(base) as JsonObject;
	for (const [key, value] of Object.entries(overlay)) {
		result[key] = Object.hasOwn(base, key)
			? mergeJson((base as JsonObject)[key], value)
			: structuredClone(value);
	}
	return result;
}

describe('Transit shared-config canary', () => {
	it('pins the immutable config Release once at the workspace root', () => {
		const manifest = json('package.json') as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const resolutions = [
			manifest.dependencies?.['@yesid/config'],
			manifest.devDependencies?.['@yesid/config'],
		].filter((value): value is string => value !== undefined);

		expect(resolutions).toEqual([CONFIG_URL]);
		expect(text('bun.lock')).toContain(CONFIG_URL);
		expect(text('bun.lock')).toContain(CONFIG_LOCK_INTEGRITY);
	});

	it('uses the shared SvelteKit preset without a redundant local TypeScript overlay', () => {
		expect(jsonc('apps/web/tsconfig.json')).toEqual({
			extends: ['./.svelte-kit/tsconfig.json', '@yesid/config/tsconfig/svelte-kit.json'],
		});
	});

	it('uses the shared project-runes policy while preserving Transit-owned Svelte settings', () => {
		const source = text('apps/web/svelte.config.js');
		expect(source).toContain("from '@yesid/config/svelte/project-runes.js'");
		expect(source).not.toContain("from 'node:path'");
		expect(webConfig.kit?.version?.pollInterval).toBe(60_000);
		expect(webConfig.kit?.adapter?.name).toBe('@sveltejs/adapter-cloudflare');
		expect(source).toMatch(
			/adapter:\s*adapter\(\{\s*routes:\s*\{\s*exclude:\s*\['\/data\/\*'\]\s*\}\s*\}\)/u,
		);

		const runes = webConfig.compilerOptions?.runes;
		expect(runes).toBeTypeOf('function');
		if (typeof runes !== 'function') return;
		expect(runes({ filename: join(REPOSITORY_ROOT, 'apps/web/src/App.svelte') })).toBe(true);
		expect(
			runes({ filename: join(REPOSITORY_ROOT, 'apps/web/node_modules/pkg/App.svelte') }),
		).toBeUndefined();
	});

	it('keeps Turbo equal to the digest-bound shared base plus the Transit overlay', () => {
		const overlayPath = '.github/shared-tooling/turbo.overlay.json';
		expect(existsSync(join(REPOSITORY_ROOT, overlayPath))).toBe(true);
		if (!existsSync(join(REPOSITORY_ROOT, overlayPath))) return;

		let packageManifestPath: string | undefined;
		try {
			packageManifestPath = createRequire(import.meta.url).resolve('@yesid/config/package.json');
		} catch {
			// The assertion below reports the missing Release dependency as contract drift.
		}
		expect(packageManifestPath).toBeDefined();
		if (!packageManifestPath) return;

		const configRoot = dirname(packageManifestPath);
		const baseBytes = readFileSync(join(configRoot, 'turbo/base.json'));
		expect(sha256(baseBytes)).toBe(CONFIG_BASE_DIGEST);
		expect(mergeJson(JSON.parse(baseBytes.toString('utf8')), json(overlayPath))).toEqual(
			json('turbo.json'),
		);
		expect(sha256(canonicalJson(json('turbo.json')))).toBe(TRANSIT_TURBO_SEMANTIC_DIGEST);
	});

	it('materializes a verified regular-file base for the symlink-rejecting drift gate', () => {
		const script = '.github/scripts/materialize-shared-config.mjs';
		expect(existsSync(join(REPOSITORY_ROOT, script))).toBe(true);
		if (!existsSync(join(REPOSITORY_ROOT, script))) return;

		const result = spawnSync(process.execPath, [script], {
			cwd: REPOSITORY_ROOT,
			encoding: 'utf8',
		});
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		const receipt = JSON.parse(result.stdout) as JsonObject;
		expect(receipt).toEqual({
			schema: 1,
			package: { name: '@yesid/config', version: '0.2.0' },
			tag: {
				name: 'config-v0.2.0',
				object: '4146d5b3e35d1ddefd3db003a630e14c9b3fbef9',
				peeledCommit: 'b88a519ade384c1e007aa7330638071bba2f6135',
			},
			destination: MATERIALIZED_BASE,
			digest: `sha256:${CONFIG_BASE_DIGEST}`,
		});

		const destination = join(REPOSITORY_ROOT, MATERIALIZED_BASE);
		expect(existsSync(destination)).toBe(true);
		expect(sha256(readFileSync(destination))).toBe(CONFIG_BASE_DIGEST);
	});
});
