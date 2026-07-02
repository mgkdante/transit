// crossFeatureImports.test.ts — the GUARDRAIL that keeps features/ leaf-isolated. A
// file under features/X may import its OWN feature (`./x`, `../selectors/y`) and any
// shared kernel ($lib/v1, $lib/site, $lib/components, $lib/i18n, …), but importing a
// SIBLING feature (features/Y) is a cross-feature leak: it welds two surfaces together
// and lets vocabulary drift silently across the seam (exactly how STATUS_LABELS /
// OCCUPANCY_LABELS drifted between map.copy and network.copy before S7.5 P3 dissolved
// them into $lib/v1/enumLabels).
//
// A handful of "features" are really shared kernels misfiled under features/ — a pure
// TS reliability lib, the site-wide metrics primitives, the map alert-label libs, the
// lines copy reused by stops. Those are quarantined in the EXEMPTIONS list below and
// are the S8–S15 relocation punch list: an exemption may be REMOVED once the kernel is
// hoisted to $lib, never added. The gate turns RED on any NEW cross-feature import.
//
// Modeled on chartDoctrine.test.ts (walks the feature tree with node:fs, carries a
// shrinks-only allowlist, ships positive/negative classifier fixtures). Runs in the
// node "data" project (reads source, no DOM).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
/** src/lib/features — the whole feature tree. */
const FEATURES_DIR = dir;

// ---------------------------------------------------------------------------
// EXEMPTIONS — the ~4 documented shared kernels misfiled under features/. Each is a
// SHRINK-ONLY debt entry (S8–S15 punch list): relocate the kernel to $lib, then delete
// the exemption. A cross-feature import is a violation UNLESS it matches an exemption.
// `source` optionally scopes an exemption to one importing feature (alerts→map,
// stops→lines) so the exemption cannot silently absorb an unrelated new leak.
// ---------------------------------------------------------------------------
type Exemption = {
	/** Importing feature this exemption applies to; omitted = any feature may import it. */
	readonly source?: string;
	/** The kernel target: `feature` = the misfiled dir, `modules` = the allowed leaves. */
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
		source: 'alerts',
		feature: 'map',
		modules: ['mapAlerts', 'gtfsAlertLabels'],
		why: 'pure GTFS alert-label libs (i18n-only) misfiled under map — belong in $lib',
	},
	{
		source: 'stops',
		feature: 'lines',
		modules: ['lines.copy'],
		why: 'stops reuses the lines detail copy — dedupe into $lib in a copy-consolidation slice',
	},
];

/** Top-level feature dir a features/ file belongs to. */
function featureOf(relPath: string): string {
	return relPath.split('/')[0];
}

/**
 * Classify an import specifier as seen from `ownFeature`.
 * Returns the target feature name if the specifier reaches a DIFFERENT sibling
 * feature (a cross-feature import), else null (same-feature or a shared kernel).
 */
function crossFeatureTarget(spec: string, filePath: string, ownFeature: string): string | null {
	// Alias form: $lib/features/<feature>/...
	const alias = spec.match(/^\$lib\/features\/([a-z0-9-]+)/);
	if (alias) return alias[1] !== ownFeature ? alias[1] : null;
	// Relative form: resolve against the file, see if it lands in another feature dir.
	if (spec.startsWith('.')) {
		const resolved = join(filePath, '..', spec).replace(/\\/g, '/');
		const rel = relative(FEATURES_DIR, resolved);
		if (rel.startsWith('..')) return null; // climbs out of features/ entirely (a shared kernel)
		const target = featureOf(rel);
		return target !== ownFeature ? target : null;
	}
	// $lib/* (non-features), bare packages — shared kernels, always allowed.
	return null;
}

/** Does `spec` (a cross-feature import from `sourceFeature`) match an exemption? */
function isExempt(spec: string, sourceFeature: string): Exemption | null {
	for (const ex of EXEMPTIONS) {
		if (ex.source && ex.source !== sourceFeature) continue;
		const hit = ex.modules.some((m) => {
			const base = `$lib/features/${ex.feature}/${m}`;
			// EXACT match, or a real submodule path (`${base}/...`). A bare startsWith would
			// wrongly exempt a sibling that merely SHARES the prefix (e.g. `${m}Evil` /
			// `${m}.copy2`), silently absorbing an unrelated new leak.
			return spec === base || spec.startsWith(`${base}/`);
		});
		if (hit) return ex;
	}
	return null;
}

/** Strip comments so the scan reads CODE, not prose. */
function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.split('\n')
		.map((l) => l.replace(/\/\/.*$/, ''))
		.join('\n');
}

/** Every import/export ... from '<spec>' (multi-line safe). */
const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
/** Side-effect import with no bindings: `import 'x'` / `import "x"` (no `from`). */
const SIDE_EFFECT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
/** Dynamic import: `import('x')` / `import ( "x" )` (await/then form). */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function collectMatches(re: RegExp, src: string, out: string[]): void {
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
}

function specifiersIn(src: string): string[] {
	const out: string[] = [];
	const clean = stripComments(src);
	// Static `import … from` / `export … from` — the common case.
	collectMatches(IMPORT_RE, clean, out);
	// Side-effect (`import 'x'`) and dynamic (`import('x')`) forms also weld two features
	// together, so a cross-feature leak via either must fail the gate too.
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

/** A leak = a cross-feature import that no exemption sanctions, keyed for reporting. */
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

	// The classifier must FLAG the exact pre-fix idiom (SearchSurface leaking the map
	// label table) and a synthetic sibling import, and SPARE every legitimate shape —
	// same-feature relative, shared $lib kernels, bare packages. This proves the gate
	// discriminates without checking out old code.
	it('flags the pre-fix SearchSurface→map label leak and a synthetic sibling import', () => {
		const searchFile = join(FEATURES_DIR, 'search/SearchSurface.svelte');
		// The exact specifier SearchSurface carried before step (b)5.
		expect(crossFeatureTarget('$lib/features/map/map.copy', searchFile, 'search')).toBe('map');
		expect(isExempt('$lib/features/map/map.copy', 'search')).toBeNull();
		// A synthetic climb-out relative sibling import.
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

	// LOW-4: side-effect (`import 'x'`) and dynamic (`import('x')`) imports weld features
	// together just as `import … from` does, so specifiersIn must surface their specifiers.
	it('surfaces side-effect and dynamic import specifiers, not just static from-imports', () => {
		const src = [
			"import { a } from '$lib/features/map/map.copy';",
			"import '$lib/features/map/sideEffect';",
			"const x = await import('$lib/features/map/dynamic');",
			"export type { T } from '$lib/features/lines/lines.copy';",
		].join('\n');
		const specs = specifiersIn(src);
		expect(specs).toContain('$lib/features/map/map.copy');
		expect(specs).toContain('$lib/features/map/sideEffect'); // side-effect form
		expect(specs).toContain('$lib/features/map/dynamic'); // dynamic form
		expect(specs).toContain('$lib/features/lines/lines.copy');
	});

	// LOW-4: isExempt matches EXACT-or-boundary, so a sibling that merely shares an
	// exempted module's prefix is NOT silently exempted (it stays a real leak).
	it('exempts the exact module + real submodules but NOT a prefix-sharing sibling', () => {
		// exact + real submodule of an exempted kernel → exempt.
		expect(isExempt('$lib/features/metrics/metrics.content', 'network')).not.toBeNull();
		expect(isExempt('$lib/features/metrics/metrics.content/deep', 'network')).not.toBeNull();
		// a sibling sharing the prefix (metrics.contentEvil) is NOT the exempted module → a leak.
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
