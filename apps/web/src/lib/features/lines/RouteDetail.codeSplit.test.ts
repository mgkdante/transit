import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) =>
	readFileSync(resolve(process.cwd(), 'src/lib/features/lines', file), 'utf8');

describe('RouteDetail reliability bundle boundary', () => {
	it('keeps the heavy reliability surface behind the active Reliability pane', () => {
		const detail = source('RouteDetail.svelte');

		expect(detail).not.toMatch(/(^|\n)\s*import\s+RouteReliabilityClusters\b/u);
		expect(detail).toContain(
			"import LazyRouteReliabilityPane from './LazyRouteReliabilityPane.svelte'",
		);
		expect(detail).not.toContain("from './reliability/clusters'");
		expect(detail).not.toContain("from './reliability/reliability.copy'");
		expect(detail).toContain("from './reliability/selectors/dayVerdictHeadline'");
		expect(detail).toContain("from './reliability/routeVerdict.copy'");

		const pane = source('LazyRouteReliabilityPane.svelte');
		expect(pane).toContain("import('./reliability/RouteReliabilityClusters.svelte')");
		expect(pane).not.toMatch(/(^|\n)\s*import\s+RouteReliabilityClusters\b/u);
		expect(pane).not.toContain("from './reliability/sections/");
	});
});
