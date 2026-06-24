import { render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RepeatOffenders from './RepeatOffenders.svelte';
import type { RepeatOffenders as RepeatOffendersData } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';

// Mutable resource payload — each test seeds it before rendering. `settled:true`
// so the ResourceBoundary renders past the skeleton straight into children (or
// the built-in empty state when the predicate trips).
let mockData: RepeatOffendersData | null = null;

vi.mock('$lib/v1', () => ({
	getRepeatOffenders: vi.fn(),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		get data() {
			return mockData;
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

beforeEach(() => {
	mockData = null;
});
afterEach(() => {
	vi.clearAllMocks();
});

const GENERATED = '2026-06-20T02:00:00Z' as IsoUtc;

describe('RepeatOffenders ranked ledger', () => {
	it('renders offenders worst-first, each linking to the offending route/stop', () => {
		mockData = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '11',
					route: '11',
					route_name: 'Montagne / Sommet',
					avg_delay_min: 12.4,
					recurrence: 'most weekday afternoons',
				},
				{
					type: 'stop',
					id: '57191',
					route: null,
					route_name: null,
					avg_delay_min: 6.2,
					recurrence: null,
				},
			],
		};

		render(RepeatOffenders);

		const list = screen.getByRole('list', { name: /ranked by average delay/i });
		// list > listitem > link: AT can count every row. The <li> owns the listitem
		// role (not the inner `bare` RankedRow, not the anchor); each row is a link.
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		const links = within(list).getAllByRole('link');
		expect(links).toHaveLength(2);

		// Worst-first order preserved from the feed: route 11 (12.4) then stop (6.2).
		expect(links[0]).toHaveTextContent('Montagne / Sommet');
		expect(links[0]).toHaveTextContent('12.4 min');
		expect(links[0]).toHaveAttribute('href', '/route/11');
		// The anchor carries the concise "View detail for …" accessible name.
		expect(links[0]).toHaveAccessibleName('View detail for Montagne / Sommet');

		// A stop offender links to its stop detail.
		expect(links[1]).toHaveAttribute('href', '/stop/57191');
		expect(links[1]).toHaveTextContent('6.2 min');
	});

	it('shows the styled honest-absence chip for a null average delay, never a fabricated 0', () => {
		mockData = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '24',
					route: '24',
					route_name: 'Sherbrooke',
					avg_delay_min: null,
					recurrence: 'weekday PM peaks',
				},
			],
		};

		const { container } = render(RepeatOffenders);

		// A null avg delay renders the ONE styled honest-absence chip (calm
		// "unknown" tone) with the aggregate "no-observations" reason copy, never a
		// plain "no data" string and never a fabricated 0.
		const chip = container.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect(chip?.getAttribute('data-tone')).toBe('unknown');
		expect(chip).toHaveTextContent(/No data/i);
		expect(chip).toHaveTextContent(/not enough readings yet/i);
		// A null delay must NOT render as "0 min" / "0.0 min".
		expect(screen.queryByText(/0\.0 min/)).not.toBeInTheDocument();
	});

	it('reads the honest recurrence fallback when a row carries no recurrence string', () => {
		mockData = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'stop',
					id: '99',
					route: null,
					route_name: null,
					avg_delay_min: 8,
					recurrence: null,
				},
			],
		};

		render(RepeatOffenders);

		expect(screen.getByText(/recurrence not recorded/i)).toBeInTheDocument();
	});

	it('renders BOTH rows when two offenders share an id on different routes (no each_key_duplicate)', () => {
		// Truth-audit case: the same offender id (vehicle 42010) is a legitimate
		// repeat offender on TWO different routes (49 AND 55) — one accountability
		// unit per (id, route), not a data bug. Keying the {#each} on the offender
		// id alone would trip Svelte's each_key_duplicate and crash the surface; the
		// (type, id, route) composite key keeps both rows.
		mockData = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '42010',
					route: '49',
					route_name: null,
					avg_delay_min: 11.3,
					recurrence: 'most weekday afternoons',
				},
				{
					type: 'route',
					id: '42010',
					route: '55',
					route_name: null,
					avg_delay_min: 9.7,
					recurrence: 'weekday PM peaks',
				},
			],
		};

		// Must not throw each_key_duplicate, and must render BOTH rows.
		expect(() => render(RepeatOffenders)).not.toThrow();

		const list = screen.getByRole('list', { name: /ranked by average delay/i });
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(2);

		// Both rows survive and link to their respective offending routes.
		const links = within(list).getAllByRole('link');
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute('href', '/route/49');
		expect(links[1]).toHaveAttribute('href', '/route/55');
	});

	it('routes an empty offenders list to the boundary empty state, never an invented row', () => {
		mockData = { generated_utc: GENERATED, offenders: [] };

		render(RepeatOffenders);

		// No ranked list rendered when the contract publishes no offenders.
		expect(
			screen.queryByRole('list', { name: /ranked by average delay/i }),
		).not.toBeInTheDocument();
	});
});
