// no-raw-brand-hex gate engine — extracted from transit's
// apps/web/src/tests/brand-doctrine.test.ts (Gate 1). The interactive orange
// and wayfinding amber must always flow through tokens; a literal hex in
// source hard-codes one theme and can never reskin. Violations are detected on
// comment-STRIPPED source. With the default hexes the compiled pattern is
// byte-identical to the source gate: /#(?:e07800|ffb627)\b/i.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { walkFiltered } from './walk.js';
import { blankComments, numbered } from './comments.js';

export const DEFAULT_BRAND_HEXES = ['#E07800', '#FFB627'] as const;

export interface BrandHexConfig {
	/** Absolute scan root (the app's src/). */
	root: string;
	/** Brand hexes to ban (default: the four-color doctrine orange + amber). */
	hexes?: readonly string[];
	/** Absolute paths where the hex is legitimately DEFINED (generated token css). */
	allowlist?: ReadonlySet<string>;
	/** Extensions scanned. Source gate: .svelte/.ts/.css minus tests. */
	extensions?: readonly string[];
}

export function buildBrandHexPattern(hexes: readonly string[]): RegExp {
	const body = hexes.map((h) => h.replace(/^#/, '').toLowerCase()).join('|');
	return new RegExp(`#(?:${body})\\b`, 'i');
}

export interface BrandHexResult {
	/** Files scanned (consumers assert > 0 to guard against a wrong path). */
	fileCount: number;
	/** '<relPath>:<line>: <trimmed line>' entries (source-gate format). */
	violations: string[];
}

export function brandHexViolations(config: BrandHexConfig): BrandHexResult {
	const extensions = config.extensions ?? ['.svelte', '.ts', '.css'];
	const allowlist = config.allowlist ?? new Set<string>();
	const pattern = buildBrandHexPattern(config.hexes ?? DEFAULT_BRAND_HEXES);
	const rootAbs = resolve(config.root);
	const files = walkFiltered(config.root, {
		extensions,
		exclude: (p) => /\.(test|spec)\.ts$/.test(p) || allowlist.has(p),
	});
	const rel = (p: string) => p.replace(rootAbs + '/', '');
	const violations: string[] = [];
	for (const file of files) {
		const scanned = blankComments(readFileSync(file, 'utf-8'));
		for (const [n, line] of numbered(scanned)) {
			if (pattern.test(line)) violations.push(`${rel(file)}:${n}: ${line.trim()}`);
		}
	}
	return { fileCount: files.length, violations };
}
