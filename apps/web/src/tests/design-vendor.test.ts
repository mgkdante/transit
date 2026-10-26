import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, sep } from 'node:path';

const VENDOR = resolve(process.cwd(), 'vendor/design');
const APP_SRC = resolve(process.cwd(), 'src');

const ADOPTED_LOCAL_PATHS = [
	...[
		'badge',
		'button',
		'card',
		'collapsible',
		'line-combobox',
		'resizable',
		'scroll-area',
		'separator',
		'sheet',
		'skeleton',
		'tabs',
		'toggle',
		'toggle-group',
	].map((family) => `lib/components/ui/${family}`),
	...[
		'BlueprintShell',
		'ChevronToggle',
		'MetroStation',
		'SectionLabel',
		'StickyPanel',
		'StopLabel',
	].map((component) => `lib/components/brand/${component}.svelte`),
	'lib/components/brand/StopLabel.svelte.test.ts',
	'lib/components/shared/TerminalCursor.svelte',
	'lib/components/shared/TocBadge.svelte',
	'lib/components/shared/TocBadge.test.ts',
	'lib/utils/create-cn.ts',
] as const;

const RETIRED_LOCAL_MOTION_PATHS = [
	'lib/motion/actions/index.ts',
	'lib/motion/actions/wordmarkHover.ts',
	'lib/motion/index.ts',
	'lib/motion/policy.ts',
	'lib/motion/reduced-motion.svelte.ts',
	'lib/motion/tokens.ts',
	'lib/motion/utils/device.ts',
	'lib/motion/utils/gsap.ts',
] as const;

const LOCAL_MOTION_IMPORT =
	/(?:from\s+|import\s*\(\s*|vi\.mock\(\s*)['"](\$lib\/motion(?:\/[^'"]*)?)['"]/g;

function findRetiredMotionImports(): string[] {
	const violations: string[] = [];

	for (const file of walkFiles(APP_SRC)) {
		if (!/\.(?:svelte|ts)$/.test(file)) continue;

		const source = readFileSync(file, 'utf-8');
		for (const match of source.matchAll(LOCAL_MOTION_IMPORT)) {
			const specifier = match[1];
			if (
				specifier === '$lib/motion/view-transition' ||
				specifier.startsWith('$lib/motion/scrubs/')
			) {
				continue;
			}

			violations.push(`${relative(APP_SRC, file)} -> ${specifier}`);
		}
	}

	return violations.sort();
}

const PINNED_RELEASE = {
	tag: 'v0.13.3',
	tagObject: '91ae5f2ad5f37f43b6355af30237bf65bb09d583',
	peeledCommit: 'd55acda36ca350715fd35ae08f194f8f35260e53',
	assetName: 'yesid.dev-design-v0.13.3.tar',
	assetSize: 819_200,
	assetDigest: 'sha256:f6fdabe8e9bb7acdb648236cbc0d7e9ea59969e0c79d2405ba4f91ffc84464d6',
	exclusionPolicyDigest: 'sha256:4f709f3409292c0971728a7f9cddb4ce06b8c354eed46cd5832e626b83af4300',
	toolDigest: 'sha256:650011070755661770506f51bc07f99ba6905fc62a573a4fcf0b668c00cbe2b8',
	treeHash: 'sha256:89c7a502515d9b97db5ed77d8b60ed21c6b896e7fcff406d7989c93414c11eb1',
	manifestDigest: '06fcc2d12ad6d777bbda863e46a2f80a864e52786cf4f97158b7fc5632a9814d',
} as const;

function walkFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir).sort()) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walkFiles(p, out);
		else out.push(p);
	}
	return out;
}

describe('vendor/design integrity', () => {
	const manifestBytes = readFileSync(join(VENDOR, 'manifest.json'));
	const manifest = JSON.parse(manifestBytes.toString('utf-8')) as {
		schema: number;
		repository: string;
		provenance: {
			mode: string;
			tag: { name: string; object: string; peeledCommit: string };
			asset: { name: string; size: number; digest: string };
		};
		packages: string[];
		exclusionPolicyDigest: string;
		toolDigest: string;
		treeHash: string;
	};

	it(`pins the immutable design-system Release (${PINNED_RELEASE.tag})`, () => {
		expect(manifest.schema).toBe(2);
		expect(manifest.repository).toBe('github.com/mgkdante/yesid.dev-design');
		expect(manifest.provenance).toEqual({
			mode: 'release',
			tag: {
				name: PINNED_RELEASE.tag,
				object: PINNED_RELEASE.tagObject,
				peeledCommit: PINNED_RELEASE.peeledCommit,
			},
			asset: {
				name: PINNED_RELEASE.assetName,
				size: PINNED_RELEASE.assetSize,
				digest: PINNED_RELEASE.assetDigest,
			},
		});
		expect(manifest.packages).toEqual([
			'tokens',
			'motion',
			'gates',
			'seo-kit',
			'ui',
			'analytics',
			'i18n-core',
		]);
		expect(manifest.exclusionPolicyDigest).toBe(PINNED_RELEASE.exclusionPolicyDigest);
		expect(manifest.toolDigest).toBe(PINNED_RELEASE.toolDigest);
		expect(walkFiles(join(VENDOR, 'i18n-core')).sort()).toEqual([
			join(VENDOR, 'i18n-core', 'README.md'),
			join(VENDOR, 'i18n-core', 'package.json'),
			join(VENDOR, 'i18n-core', 'src', 'index.ts'),
			join(VENDOR, 'i18n-core', 'src', 'routing.ts'),
			join(VENDOR, 'i18n-core', 'tsconfig.json'),
		]);
		expect(manifest.treeHash).toBe(PINNED_RELEASE.treeHash);
		expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(
			PINNED_RELEASE.manifestDigest,
		);
	});

	it('carries the upstream adoption tool and retires the consumer implementation', () => {
		const tool = join(VENDOR, 'tools/adopt.ts');

		expect(existsSync(tool)).toBe(true);
		expect(existsSync(resolve(process.cwd(), 'tools/design-sync.ts'))).toBe(false);
	});

	it('vendors the @yesid/ui runtime surface without package tests', () => {
		const uiRoot = join(VENDOR, 'ui');
		const packageJson = JSON.parse(readFileSync(join(uiRoot, 'package.json'), 'utf-8')) as {
			name: string;
			version: string;
			dependencies: Record<string, string>;
		};
		const files = walkFiles(uiRoot).map((file) => relative(uiRoot, file).split(sep).join('/'));

		expect(packageJson.name).toBe('@yesid/ui');
		expect(packageJson.version).toBe('0.13.3');
		expect(readFileSync(join(VENDOR, 'LICENSE'), 'utf-8')).toContain('MIT License');
		expect(packageJson.dependencies['@yesid/motion']).toBe('file:../motion');
		expect(Object.values(packageJson.dependencies)).not.toContain('workspace:*');
		expect(files).toContain('src/primitives/button/button.svelte');
		expect(files).toContain('src/primitives/combobox/combobox.svelte');
		expect(files).not.toContain('src/primitives/line-combobox/line-combobox.svelte');
		expect(files).toContain('src/brand/BlueprintShell.svelte');
		expect(files).toContain('src/brand/QuietModeButton.svelte');
		expect(existsSync(join(VENDOR, 'gates/src/presets'))).toBe(false);
		expect(
			files.filter((file) => /(?:^|\/)(?:test-fixtures\/|vitest\.)|\.test\.ts$/.test(file)),
		).toEqual([]);
	});

	it('vendors the exact @yesid/analytics runtime surface', () => {
		const analyticsRoot = join(VENDOR, 'analytics');
		const packageJson = JSON.parse(readFileSync(join(analyticsRoot, 'package.json'), 'utf-8')) as {
			name: string;
			version: string;
		};
		const files = walkFiles(analyticsRoot).map((file) =>
			relative(analyticsRoot, file).split(sep).join('/'),
		);

		expect(packageJson).toMatchObject({
			name: '@yesid/analytics',
			version: '0.13.3',
		});
		expect(files).toEqual([
			'README.md',
			'package.json',
			'src/client.ts',
			'src/config.ts',
			'src/consent.svelte.ts',
			'src/index.ts',
			'src/plausible.ts',
			'src/policy.ts',
			'tsconfig.json',
		]);
	});
});

describe('@yesid/ui adoption', () => {
	it('does not retain local copies of adopted package code', () => {
		const retained = ADOPTED_LOCAL_PATHS.filter((path) => existsSync(join(APP_SRC, path)));

		expect(retained).toEqual([]);
	});
});

describe('@yesid/motion adoption', () => {
	it('keeps one upstream authority and only product-specific local motion', () => {
		const retained = RETIRED_LOCAL_MOTION_PATHS.filter((path) => existsSync(join(APP_SRC, path)));

		expect(retained).toEqual([]);
		expect(findRetiredMotionImports()).toEqual([]);
	});
});
