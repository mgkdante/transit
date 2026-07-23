// design-vendor.test.ts — integrity gates on the vendored design system.
//
// The upstream adoption tool owns the hash algorithm and validates the complete
// schema-2 trust record. Transit pins one exact immutable Release and keeps only
// product tests plus this fast consumer-side integrity gate.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';

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
	tag: 'v0.11.1',
	tagObject: '22443d66d2de3be26a395561b400a57452dcfc10',
	peeledCommit: '5916438399e9f24030d5380aa2ea1158ba68fc9e',
	assetName: 'yesid.dev-design-v0.11.1.tar',
	assetSize: 798_720,
	assetDigest: 'sha256:1e62de2e76178a12e5e44060ee9568b910ae9e16ec923f87627e7e43be88ed7f',
	exclusionPolicyDigest: 'sha256:4f709f3409292c0971728a7f9cddb4ce06b8c354eed46cd5832e626b83af4300',
	toolDigest: 'sha256:c3d4af6788407c6affd312172455da127c1e2e40cb0d623be6d51ca31672c18e',
	treeHash: 'sha256:f5aa5dc3325e7a2f33bbd529cf297987219ad81d80ec8a6fe74db146e4c9cffa',
	manifestDigest: 'dcd3dec78edea3123e0fab23204988abae5520cb37e15049114eaa79080e0efe',
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
		expect(manifest.packages).toEqual(['tokens', 'motion', 'gates', 'seo-kit', 'ui', 'analytics']);
		expect(manifest.exclusionPolicyDigest).toBe(PINNED_RELEASE.exclusionPolicyDigest);
		expect(manifest.toolDigest).toBe(PINNED_RELEASE.toolDigest);
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
		const files = walkFiles(uiRoot).map((file) => relative(uiRoot, file));

		expect(packageJson.name).toBe('@yesid/ui');
		expect(packageJson.version).toBe('0.11.1');
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
		const files = walkFiles(analyticsRoot).map((file) => relative(analyticsRoot, file));

		expect(packageJson).toMatchObject({
			name: '@yesid/analytics',
			version: '0.11.1',
		});
		expect(files).toEqual([
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
