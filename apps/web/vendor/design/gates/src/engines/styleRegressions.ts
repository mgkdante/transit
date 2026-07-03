// tokens-only gate engine — extracted from yesid.dev @ 2bdb611d
// apps/web/src/tests/style-regressions.test.ts. The FORBIDDEN-table scan is
// byte-equivalent: per pattern, list every file whose CONTENT matches, reported
// relative to the scan root. The app-specific art-direction pinning that made
// up the rest of that file stays app-side — it is the per-app taste contract.
import { readFileSync } from 'node:fs';
import { walk } from './walk.js';

export interface ForbiddenPattern {
	pattern: RegExp;
	reason: string;
}

export interface StyleRegressionConfig {
	/** Absolute scan root (the app's src/). */
	root: string;
	/** File extensions to scan. Source gate default: ['.svelte']. */
	extensions?: readonly string[];
	forbidden: readonly ForbiddenPattern[];
}

export interface ForbiddenHit {
	pattern: RegExp;
	reason: string;
	/** File paths with the scan root replaced by 'src' (source-gate format). */
	hits: string[];
}

/** Run the FORBIDDEN table over the tree; one entry per pattern (empty hits = pass). */
export function styleRegressionViolations(config: StyleRegressionConfig): ForbiddenHit[] {
	const extensions = config.extensions ?? ['.svelte'];
	const files = walk(config.root, extensions);
	return config.forbidden.map(({ pattern, reason }) => ({
		pattern,
		reason,
		hits: files
			.filter((f) => pattern.test(readFileSync(f, 'utf-8')))
			.map((f) => f.replace(config.root, 'src')),
	}));
}
