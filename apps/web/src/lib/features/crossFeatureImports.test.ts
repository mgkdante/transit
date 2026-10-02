import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const FEATURES_DIR = dir;

type Exemption = {
	readonly source?: string;
	readonly feature: string;
	readonly modules: readonly string[];
	readonly why: string;
};

const EXEMPTIONS: readonly Exemption[] = [
	{
		feature: 'reliability',
		modules: ['domains', 'shiftGrains'],
		why: 'pure TS reliability kernel (no .svelte, no page) — belongs in $lib',
	},
	{
		feature: 'metrics',
		modules: ['MetricInfo.svelte', 'metrics.content', 'metrics.copy'],
		why: 'site-wide metric primitives (info popover + methodology content/copy) — belong in $lib',
	},
	{
		source: 'stops',
		feature: 'lines',
		modules: ['lines.copy'],
		why: 'stops reuses the lines detail copy — dedupe into $lib in a copy-consolidation slice',
	},
];

function featureOf(relPath: string): string {
	return relPath.split('/')[0];
}

function crossFeatureTarget(spec: string, filePath: string, ownFeature: string): string | null {
	const alias = spec.match(/^\$lib\/features\/([a-z0-9-]+)/);
	if (alias) return alias[1] !== ownFeature ? alias[1] : null;
	if (spec.startsWith('.')) {
		const resolved = join(filePath, '..', spec);
		const rel = relative(FEATURES_DIR, resolved).split(sep).join('/');
		if (rel.startsWith('..')) return null;
		const target = featureOf(rel);
		return target !== ownFeature ? target : null;
	}
	return null;
}

function isExempt(spec: string, sourceFeature: string): Exemption | null {
	for (const ex of EXEMPTIONS) {
		if (ex.source && ex.source !== sourceFeature) continue;
		const hit = ex.modules.some((m) => {
			const base = `$lib/features/${ex.feature}/${m}`;
			return spec === base || spec.startsWith(`${base}/`);
		});
		if (hit) return ex;
	}
	return null;
}

function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.split('\n')
		.map((l) => l.replace(/\/\/.*$/, ''))
		.join('\n');
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function collectMatches(re: RegExp, src: string, out: string[]): void {
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
}

function specifiersIn(src: string): string[] {
	const out: string[] = [];
	const clean = stripComments(src);
	collectMatches(IMPORT_RE, clean, out);
	collectMatches(SIDE_EFFECT_RE, clean, out);
	collectMatches(DYNAMIC_IMPORT_RE, clean, out);
	return out;
}

type ScanFile = { label: string; path: string };
function filesIn(root: string): ScanFile[] {
	const out: ScanFile[] = [];
	const walk = (d: string): void => {
		for (const ent of readdirSync(d, { withFileTypes: true })) {
			const full = join(d, ent.name);
			if (ent.isDirectory()) walk(full);
			else if (
				(ent.name.endsWith('.svelte') || ent.name.endsWith('.ts')) &&
				!ent.name.includes('.test.')
			)
				out.push({ label: relative(root, full).replace(/\\/g, '/'), path: full });
		}
	};
	walk(root);
	return out;
}

const FEATURE_FILES = filesIn(FEATURES_DIR);

type Leak = { label: string; spec: string; target: string };
function scanLeaks(): { leaks: Leak[]; exemptHits: Set<Exemption> } {
	const leaks: Leak[] = [];
	const exemptHits = new Set<Exemption>();
	for (const { label, path } of FEATURE_FILES) {
		const own = featureOf(label);
		const src = readFileSync(path, 'utf8');
		for (const spec of specifiersIn(src)) {
			const target = crossFeatureTarget(spec, path, own);
			if (target === null) continue;
			const ex = isExempt(spec, own);
			if (ex) {
				exemptHits.add(ex);
				continue;
			}
			leaks.push({ label, spec, target });
		}
	}
	return { leaks, exemptHits };
}

describe('cross-feature imports — features/ leaves stay isolated (shared kernels via $lib)', () => {
	it('the scan covers the whole feature tree', () => {
		expect(FEATURE_FILES.length).toBeGreaterThan(30);
	});

	it('flags the pre-fix SearchSurface→map label leak and a synthetic sibling import', () => {
		const searchFile = join(FEATURES_DIR, 'search/SearchSurface.svelte');
		expect(crossFeatureTarget('$lib/features/map/map.copy', searchFile, 'search')).toBe('map');
		expect(isExempt('$lib/features/map/map.copy', 'search')).toBeNull();
		const netFile = join(FEATURES_DIR, 'network/reliability/sections/NetworkSurface.svelte');
		expect(crossFeatureTarget('../../../map/map.copy', netFile, 'network')).toBe('map');
	});

	it('spares same-feature, shared-kernel and package imports', () => {
		const mapFile = join(FEATURES_DIR, 'map/MapFilters.svelte');
		expect(crossFeatureTarget('./map.copy', mapFile, 'map')).toBeNull();
		const selFile = join(FEATURES_DIR, 'lines/reliability/selectors/habitsHeatmap.ts');
		expect(crossFeatureTarget('../clusters', selFile, 'lines')).toBeNull();
		expect(crossFeatureTarget('$lib/v1', mapFile, 'map')).toBeNull();
		expect(crossFeatureTarget('$lib/components/edge', mapFile, 'map')).toBeNull();
		expect(crossFeatureTarget('$lib/site/absence', mapFile, 'map')).toBeNull();
		expect(crossFeatureTarget('layerchart', mapFile, 'map')).toBeNull();
	});

	it('surfaces side-effect and dynamic import specifiers, not just static from-imports', () => {
		const src = [
			"import { a } from '$lib/features/map/map.copy';",
			"import '$lib/features/map/sideEffect';",
			"const x = await import('$lib/features/map/dynamic');",
			"export type { T } from '$lib/features/lines/lines.copy';",
		].join('\n');
		const specs = specifiersIn(src);
		expect(specs).toContain('$lib/features/map/map.copy');
		expect(specs).toContain('$lib/features/map/sideEffect');
		expect(specs).toContain('$lib/features/map/dynamic');
		expect(specs).toContain('$lib/features/lines/lines.copy');
	});

	it('exempts the exact module + real submodules but NOT a prefix-sharing sibling', () => {
		expect(isExempt('$lib/features/metrics/metrics.content', 'network')).not.toBeNull();
		expect(isExempt('$lib/features/metrics/metrics.content/deep', 'network')).not.toBeNull();
		expect(isExempt('$lib/features/metrics/metrics.contentEvil', 'network')).toBeNull();
	});

	it('every exemption is still LOAD-BEARING (no stale kernel entry)', () => {
		const { exemptHits } = scanLeaks();
		for (const ex of EXEMPTIONS) {
			const scope = ex.source ? `${ex.source}→` : '';
			expect(
				exemptHits.has(ex),
				`stale exemption (no live import matches it — delete it): ${scope}${ex.feature}/{${ex.modules.join(',')}}`,
			).toBe(true);
		}
	});

	it('every exempted kernel module still exists on disk', () => {
		for (const ex of EXEMPTIONS) {
			for (const m of ex.modules) {
				const base = join(FEATURES_DIR, ex.feature, m);
				const found =
					existsSync(base) ||
					existsSync(`${base}.ts`) ||
					existsSync(`${base}.svelte`) ||
					existsSync(`${base}.js`);
				expect(found, `stale exemption module (gone / renamed): ${ex.feature}/${m}`).toBe(true);
			}
		}
	});

	it('NO un-exempted cross-feature import (features stay isolated)', () => {
		const { leaks } = scanLeaks();
		const report = leaks.map((l) => `${l.label} -> ${l.spec}`).sort();
		expect(
			report,
			`cross-feature leak(s) — move the shared code to $lib:\n${report.join('\n')}`,
		).toEqual([]);
	});
});
