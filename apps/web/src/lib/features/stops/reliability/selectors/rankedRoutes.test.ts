import { createLineDirectory } from '#lib/site/lineDirectory.ts';
import { describe, it, expect } from 'vitest';
import { selectRankedRoutes } from './rankedRoutes';
import { DELAY_POS_DOMAIN } from '#lib/features/reliability/shiftGrains.ts';
import type { StopByRoute } from '#lib/v1/schemas/index.ts';

const fmt = (v: number | null) => (v == null ? 'No data' : `${v.toFixed(1)} min`);
const directory = createLineDirectory(null, { line: (id) => `Line ${id}` });
const links = {
	href: (routeId: string) => `/lines/${encodeURIComponent(routeId)}`,
};

describe('selectRankedRoutes', () => {
	it('ranks worst-delay first on the FIXED DELAY_POS_DOMAIN (never in-view max)', () => {
		const byRoute: StopByRoute[] = [
			{ route: '24', avg_delay_min: 3.2 },
			{ route: '80', avg_delay_min: 11.5 },
			{ route: '51', avg_delay_min: 6.0 },
		];
		const rows = selectRankedRoutes(byRoute, fmt, links, directory);
		expect(rows.map((r) => r.title)).toEqual(['80', '51', '24']);
		expect(rows[0].domain).toEqual(DELAY_POS_DOMAIN);
		expect(rows[0].domain[0]).toBe(0);
		expect(rows[0].severity).toBe('critical');
		expect(rows[1].severity).toBe('high');
		expect(rows[2].severity).toBe('watch');
	});

	it('carries a canonical encoded line link without inheriting the Stop query', () => {
		const rows = selectRankedRoutes([{ route: 'A/B ?#', avg_delay_min: 4 }], fmt, links, directory);

		expect(rows[0].href).toBe('/lines/A%2FB%20%3F%23');
		expect(rows[0].ariaLabel).toBe('Line A/B ?#');
	});

	it('DROPS null-delay routes (no fake-0 ranking)', () => {
		const rows = selectRankedRoutes(
			[
				{ route: '24', avg_delay_min: null },
				{ route: '80', avg_delay_min: 4.0 },
			],
			fmt,
			links,
			directory,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('80');
	});

	it('is honest on null/empty input', () => {
		expect(selectRankedRoutes(null, fmt, links, directory)).toEqual([]);
		expect(selectRankedRoutes([], fmt, links, directory)).toEqual([]);
	});
});
it('ladder rows lead with the line number', () => {
	const directory = createLineDirectory(
		[{ id: '1-373', short: '1', long: 'Confederation', type: 1 }],
		{ line: (id) => `Line ${id}` },
	);
	expect(
		selectRankedRoutes([{ route: '1-373', avg_delay_min: 4 }], fmt, links, directory)[0].title,
	).toBe('1');
	expect(
		selectRankedRoutes([{ route: '1-373', avg_delay_min: 4 }], fmt, links, directory)[0].ariaLabel,
	).toBe('Line 1');
});
