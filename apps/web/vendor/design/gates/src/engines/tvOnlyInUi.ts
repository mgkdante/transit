// tv()-only-in-ui gate — MINTED HERE (2026-07-02). No such test existed in
// yesid.dev @ 2bdb611d or in transit; both repos held it as a review-enforced
// convention (tv() imports appear only under src/lib/components/ui/*: yesid —
// badge, button, tabs-list, toggle; transit — 7 files, all under ui/). This
// gate codifies the observed convention; it makes NO byte-equivalence claim.
//
// Rule: a VALUE import from 'tailwind-variants' (i.e. anything that can call
// tv()) is only legal inside the configured uiRoot(s). Type-only imports
// (`import type { VariantProps } ...`) are allowed anywhere.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { walkFiltered } from './walk.js';
import { blankComments } from './comments.js';

export interface TvOnlyInUiConfig {
	/** Absolute scan root (the app's src/). */
	root: string;
	/** Roots (absolute) under which tailwind-variants value imports are legal. */
	uiRoots: readonly string[];
	extensions?: readonly string[];
}

// Matches any import statement from 'tailwind-variants' that is NOT type-only.
// Multi-line friendly: [\s\S]*? spans line breaks inside the specifier list.
const TV_VALUE_IMPORT = /import\s+(?!type\b)[\s\S]*?from\s*['"]tailwind-variants['"]/g;

export interface TvGateResult {
	fileCount: number;
	/** '<relPath>: <matched import (collapsed)>' entries. */
	violations: string[];
}

export function tvOnlyInUiViolations(config: TvOnlyInUiConfig): TvGateResult {
	const extensions = config.extensions ?? ['.svelte', '.ts'];
	const rootAbs = resolve(config.root);
	const uiRoots = config.uiRoots.map((r) => resolve(r));
	const files = walkFiltered(config.root, {
		extensions,
		exclude: (p) => /\.(test|spec)\.ts$/.test(p) || uiRoots.some((ui) => p.startsWith(ui + '/')),
	});
	const rel = (p: string) => p.replace(rootAbs + '/', '');
	const violations: string[] = [];
	for (const file of files) {
		const scanned = blankComments(readFileSync(file, 'utf-8'));
		const matches = scanned.match(TV_VALUE_IMPORT);
		if (!matches) continue;
		for (const m of matches) {
			violations.push(`${rel(file)}: ${m.replace(/\s+/g, ' ').trim()}`);
		}
	}
	return { fileCount: files.length, violations };
}
