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
		'CornerMarks',
		'MetroStation',
		'NumberedChip',
		'SectionHeading',
		'SectionLabel',
		'StatusDot',
		'StickyPanel',
		'StopLabel',
	].map((component) => `lib/components/brand/${component}.svelte`),
	'lib/components/brand/StopLabel.svelte.test.ts',
	...['CollapsibleSection', 'SectionIcon', 'TocNav', 'TocPill'].map(
		(component) => `lib/components/shared/${component}.svelte`,
	),
	'lib/components/shared/toc.ts',
	'lib/components/shared/TerminalCursor.svelte',
	'lib/components/shared/TocBadge.svelte',
	'lib/components/shared/TocBadge.test.ts',
	'lib/components/filter/FilterGroup.svelte',
	'lib/components/filter/FilterSummary.svelte',
	'lib/components/layout/ListingPageShell.svelte',
	'lib/components/layout/DetailShell.svelte',
	'lib/components/layout/ArticleHeader.svelte',
	'lib/components/layout/Footer.svelte',
	'lib/components/shared/ErrorIllustration.svelte',
	'lib/utils/create-cn.ts',
	'lib/utils/cn.ts',
	'lib/components/shared/modalSheet.ts',
	'lib/components/shell/ThemeToggle.svelte',
	'lib/nav/layout.svelte.ts',
	'lib/stores/persisted.svelte.ts',
	'lib/stores/quiet-mode.svelte.ts',
	'lib/stores/theme.svelte.ts',
] as const;

const RETIRED_LOCAL_MOTION_PATHS = [
	'lib/motion/actions/index.ts',
	'lib/motion/actions/wordmarkHover.ts',
	'lib/motion/index.ts',
	'lib/motion/policy.ts',
	'lib/motion/reduced-motion.svelte.ts',
	'lib/motion/tokens.ts',
	'lib/motion/view-transition.ts',
	'lib/motion/view-transition.test.ts',
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
			if (specifier.startsWith('$lib/motion/scrubs/')) {
				continue;
			}

			violations.push(`${relative(APP_SRC, file)} -> ${specifier}`);
		}
	}

	return violations.sort();
}

const PINNED_RELEASE = {
	tag: 'v0.20.0',
	tagObject: '31bf2ad3a8d71a38c5d2e8a377a9bc7e0bfa332a',
	peeledCommit: 'bd82c869bdeefe73987a1be3989fc2e1f763fb00',
	assetName: 'yesid.dev-design-v0.20.0.tar',
	assetSize: 1474560,
	assetDigest: 'sha256:30d94d267068ba32e2ba97f98e13725fe5928ecdc56450d24d363184a9f4629a',
	exclusionPolicyDigest: 'sha256:4f709f3409292c0971728a7f9cddb4ce06b8c354eed46cd5832e626b83af4300',
	toolDigest: 'sha256:3d688b437650357ca30a5c3e37e64885a2fb4a9b76f37baf5ee554f5f98956f6',
	treeHash: 'sha256:ca3a2f87cf9cab6e65d2433e4e060a4ae0417312813eecf025c021867c647325',
	manifestDigest: '6dbe4f7da8ebf8e1db6c6e8351174f28be2cb9bd147ec0d3e572c5a1a36f1636',
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
		expect(packageJson.version).toBe('0.20.0');
		expect(readFileSync(join(VENDOR, 'LICENSE'), 'utf-8')).toContain('MIT License');
		expect(packageJson.dependencies['@yesid/motion']).toBe('file:../motion');
		expect(Object.values(packageJson.dependencies)).not.toContain('workspace:*');
		expect(files).toContain('src/primitives/button/button.svelte');
		expect(files).toContain('src/primitives/combobox/combobox.svelte');
		expect(files).not.toContain('src/primitives/line-combobox/line-combobox.svelte');
		expect(files).toContain('src/brand/BlueprintShell.svelte');
		expect(files).toContain('src/brand/QuietModeButton.svelte');
		expect(files).toContain('src/brand/ThemeToggle.svelte');
		expect(files).toContain('src/brand/CollapsibleSection.svelte');
		expect(files).toContain('src/brand/TocNav.svelte');
		expect(files).toContain('src/brand/FilterGroup.svelte');
		expect(files).toContain('src/brand/FilterSection.svelte');
		expect(files).toContain('src/brand/FilterSummary.svelte');
		expect(files).toContain('src/brand/SearchInput.svelte');
		expect(files).toContain('src/layout/ListingFrame.svelte');
		expect(files).toContain('src/layout/DetailFrame.svelte');
		expect(files).toContain('src/layout/ArticleHeader.svelte');
		expect(files).toContain('src/layout/SiteFooter.svelte');
		expect(files).toContain('src/layout/ErrorPage.svelte');
		expect(files).toContain('src/state/persisted.svelte.js');
		expect(files).toContain('src/layout/SiteRoot.svelte');
		expect(files).toContain('src/state/theme.svelte.js');
		expect(files).toContain('src/state/theme.svelte.d.ts');
		expect(files).toContain('src/state/quiet-mode.svelte.js');
		expect(files).toContain('src/state/quiet-mode.svelte.d.ts');
		expect(files).not.toContain('src/state/theme.svelte.ts');
		expect(files).not.toContain('src/state/quiet-mode.svelte.ts');
		expect(existsSync(join(VENDOR, 'gates/src/presets'))).toBe(false);
		expect(
			files.filter((file) => /(?:^|\/)(?:test-fixtures\/|vitest\.)|\.test\.ts$/.test(file)),
		).toEqual([]);
	});

	it('vendors the bundled fonts and the Tailwind theme map with the tokens', () => {
		const tokensRoot = join(VENDOR, 'tokens');
		const files = walkFiles(tokensRoot).map((file) =>
			relative(tokensRoot, file).split(sep).join('/'),
		);

		expect(files).toEqual(
			expect.arrayContaining([
				'fonts.css',
				'theme.css',
				'tokens.css',
				'fonts/LICENSE-Inter.txt',
				'fonts/LICENSE-JetBrainsMono.txt',
				'fonts/inter-latin-wght-normal.woff2',
				'fonts/jetbrains-mono-latin-wght-normal.woff2',
				'src/fonts.ts',
				'src/generators/theme-css.ts',
			]),
		);
		expect(files.filter((file) => file.endsWith('.woff2'))).toHaveLength(4);
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
			version: '0.20.0',
		});
		expect(files).toEqual([
			'README.md',
			'package.json',
			'src/client.ts',
			'src/config.ts',
			'src/consent.ts',
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
	it('credits the Lenis stylesheet vendored with motion', () => {
		expect(existsSync(join(VENDOR, 'motion/lenis.css'))).toBe(true);
		expect(readFileSync(resolve(process.cwd(), '../../NOTICE'), 'utf-8')).toContain(
			'darkroom.engineering',
		);
	});

	it('keeps one upstream authority and only product-specific local motion', () => {
		const retained = RETIRED_LOCAL_MOTION_PATHS.filter((path) => existsSync(join(APP_SRC, path)));

		expect(retained).toEqual([]);
		expect(findRetiredMotionImports()).toEqual([]);
	});
});
