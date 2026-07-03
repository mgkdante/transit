// Recursive file walk — traversal semantics preserved byte-equivalent from the
// source gates (yesid.dev style-regressions.test.ts / transit
// brand-doctrine.test.ts @ their extraction anchors). No glob library on
// purpose: the existing gates' behavior IS the contract.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Collect files under `dir` whose path ends with one of `extensions`. */
export function walk(dir: string, extensions: readonly string[], out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, extensions, out);
		else if (extensions.some((ext) => p.endsWith(ext))) out.push(p);
	}
	return out;
}

/**
 * Wider walk with an exclusion predicate — the transit brand-hex traversal
 * shape (all matching source minus tests minus an absolute-path allowlist).
 */
export function walkFiltered(
	dir: string,
	options: {
		extensions: readonly string[];
		exclude?: (absPath: string) => boolean;
	},
	out: string[] = [],
): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walkFiltered(p, options, out);
		else if (
			options.extensions.some((ext) => p.endsWith(ext)) &&
			!(options.exclude?.(p) ?? false)
		)
			out.push(p);
	}
	return out;
}
