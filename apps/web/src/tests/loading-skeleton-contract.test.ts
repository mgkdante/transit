import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = join(process.cwd(), 'src');

/**
 * These surfaces fetch progressive enhancements without blocking their primary UI:
 * - MapHero mounts the full-bleed map immediately and owns targeted overlay loading states.
 * - MetricsExplainer is readable static methodology; only its optional provenance metadata loads.
 * - The root layout's search indexes stay idle until someone types and never gate the page tree.
 */
const INTENTIONAL_PROGRESSIVE_EXCLUSIONS = new Set([
	'lib/features/map/MapHero.svelte',
	'lib/features/metrics/MetricsExplainer.svelte',
	'routes/+layout.svelte',
]);

function svelteFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : [];
	});
}

describe('site-wide loading skeleton contract', () => {
	it('routes every blocking createResource surface through the shared loading fallback', () => {
		const resourceSurfaces = svelteFiles(APP_ROOT)
			.map((path) => ({
				path,
				relativePath: relative(APP_ROOT, path),
				source: readFileSync(path, 'utf8'),
			}))
			.filter(({ source }) => source.includes('createResource('));

		const uncovered = resourceSurfaces
			.filter(({ relativePath, source }) => {
				const ownsSharedFallback =
					source.includes('<ResourceBoundary') || source.includes('variant="skeleton"');
				return !ownsSharedFallback && !INTENTIONAL_PROGRESSIVE_EXCLUSIONS.has(relativePath);
			})
			.map(({ relativePath }) => relativePath);

		expect(uncovered).toEqual([]);
	});

	it('keeps the progressive exclusion list exact and documented', () => {
		const actualExclusions = svelteFiles(APP_ROOT)
			.map((path) => ({
				relativePath: relative(APP_ROOT, path),
				source: readFileSync(path, 'utf8'),
			}))
			.filter(
				({ source }) =>
					source.includes('createResource(') &&
					!source.includes('<ResourceBoundary') &&
					!source.includes('variant="skeleton"'),
			)
			.map(({ relativePath }) => relativePath)
			.sort();

		expect(actualExclusions).toEqual([...INTENTIONAL_PROGRESSIVE_EXCLUSIONS].sort());
	});
});
