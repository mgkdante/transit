import { describe, it, expect } from 'vitest';
import { selectRankedRoutes } from './rankedRoutes';
import { DELAY_POS_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { StopByRoute } from '$lib/v1/schemas';

const fmt = (v: number | null) => (v == null ? 'No data' : `${v.toFixed(1)} min`);
const links = {
	href: (routeId: string) => `/lines/${encodeURIComponent(routeId)}`,
	ariaLabel: (routeId: string) => `View line ${routeId}`,
};

describe('selectRankedRoutes', () => {
	it('ranks worst-delay first on the FIXED DELAY_POS_DOMAIN (never in-view max)', () => {
		const byRoute: StopByRoute[] = [
			{ route: '24', avg_delay_min: 3.2 },
			{ route: '80', avg_delay_min: 11.5 },
			{ route: '51', avg_delay_min: 6.0 },
		];
		const rows = selectRankedRoutes(byRoute, fmt, links);
		expect(rows.map((r) => r.title)).toEqual(['80', '51', '24']);
		expect(rows[0].domain).toEqual(DELAY_POS_DOMAIN);
		expect(rows[0].domain[0]).toBe(0);
		// severity bands off the absolute delay, not the rank.
		expect(rows[0].severity).toBe('critical'); // >=10
		expect(rows[1].severity).toBe('high'); // >=5
		expect(rows[2].severity).toBe('watch');
	});

	it('carries a canonical encoded line link without inheriting the Stop query', () => {
		const rows = selectRankedRoutes([{ route: 'A/B ?#', avg_delay_min: 4 }], fmt, links);

		expect(rows[0].href).toBe('/lines/A%2FB%20%3F%23');
		expect(rows[0].ariaLabel).toBe('View line A/B ?#');
	});

	it('DROPS null-delay routes (no fake-0 ranking)', () => {
		const rows = selectRankedRoutes(
			[
				{ route: '24', avg_delay_min: null },
				{ route: '80', avg_delay_min: 4.0 },
			],
			fmt,
			links,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('80');
	});

	it('is honest on null/empty input', () => {
		expect(selectRankedRoutes(null, fmt, links)).toEqual([]);
		expect(selectRankedRoutes([], fmt, links)).toEqual([]);
	});
});
