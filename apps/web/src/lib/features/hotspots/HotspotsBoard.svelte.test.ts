import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hotspots, IsoUtc } from '$lib/v1/schemas';
import HotspotsBoard from './HotspotsBoard.svelte';

// A mutable hoisted payload so each test can seed the resource (worst-first list
// vs an empty array) before rendering. `getLocale()` is left unmocked → it
// returns DEFAULT_LOCALE ('en'), and $lib/i18n + $lib/nav stay REAL so the deep
// links resolve to genuine /route/<id> and /stop/<id> hrefs.
const { payload } = vi.hoisted(() => ({
	payload: {
		current: {
			generated_utc: '2026-06-18T07:00:00Z' as IsoUtc,
			hotspots: [
				// Worst first (rank 1): a route with the largest OTP-points delta →
				// fills the magnitude bar; banded 'critical'.
				{
					rank: 1,
					type: 'route',
					id: '161',
					name: 'Van Horne',
					otp_delta_pts: -12.4,
					severity: 'critical',
				},
				// A stop, lesser delta → a relative bar; banded 'high'.
				{
					rank: 2,
					type: 'stop',
					id: '57191',
					name: 'Berri / Fleury',
					otp_delta_pts: -6.2,
					severity: 'high',
				},
				// Honesty fixture: a null OTP delta → honest no-data display + a null
				// (no-data) magnitude bar, never a fabricated 0. Unknown severity →
				// quiet 'watch' band, never a guessed 'critical'.
				{ rank: 3, type: 'route', id: '24', name: null, otp_delta_pts: null, severity: 'mystery' },
			],
		} satisfies Hotspots as Hotspots,
	},
}));

vi.mock('$lib/v1', () => ({
	getHotspots: vi.fn(),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: payload.current,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

describe('HotspotsBoard ranked list', () => {
	beforeEach(() => {
		payload.current = {
			generated_utc: '2026-06-18T07:00:00Z' as IsoUtc,
			hotspots: [
				{
					rank: 1,
					type: 'route',
					id: '161',
					name: 'Van Horne',
					otp_delta_pts: -12.4,
					severity: 'critical',
				},
				{
					rank: 2,
					type: 'stop',
					id: '57191',
					name: 'Berri / Fleury',
					otp_delta_pts: -6.2,
					severity: 'high',
				},
				{ rank: 3, type: 'route', id: '24', name: null, otp_delta_pts: null, severity: 'mystery' },
			],
		} satisfies Hotspots as Hotspots;
	});

	it('renders the head and the worst-first ranked list', () => {
		render(HotspotsBoard);
		expect(screen.getByRole('heading', { name: 'Hotspots' })).toBeInTheDocument();
		const list = screen.getByRole('list', { name: 'Hotspots ranked worst first' });
		expect(list).toBeInTheDocument();
	});

	it('exposes a clean list > listitem > link ownership (AT can count every row)', () => {
		render(HotspotsBoard);
		const list = screen.getByRole('list', { name: 'Hotspots ranked worst first' });
		// One listitem per published row — the <li> owns the role, NOT the inner
		// RankedRow (which is `bare`) and NOT the intervening <a>. AT counts 3.
		expect(within(list).getAllByRole('listitem')).toHaveLength(3);
		// Every fixture row resolves to a route/stop detail link (all 3 are known
		// types), so each listitem carries exactly one link.
		expect(within(list).getAllByRole('link')).toHaveLength(3);
	});

	it('deep-links a route hotspot to its route detail and a stop hotspot to its stop detail', () => {
		render(HotspotsBoard);
		expect(screen.getByRole('link', { name: 'View detail for Van Horne' })).toHaveAttribute(
			'href',
			'/route/161',
		);
		expect(screen.getByRole('link', { name: 'View detail for Berri / Fleury' })).toHaveAttribute(
			'href',
			'/stop/57191',
		);
	});

	it('shows the honest on-time-points-lost reading for a row WITH a delta', () => {
		render(HotspotsBoard);
		// -12.4 reads as its magnitude: "12.4 on-time points lost".
		expect(screen.getByText('12.4 on-time points lost')).toBeInTheDocument();
	});

	it('renders the honest no-data string for a row whose OTP delta is absent', () => {
		render(HotspotsBoard);
		const unnamed = screen.getByRole('link', { name: 'View detail for Item 24' });
		expect(unnamed).toBeInTheDocument();
		// The null-delta row never fabricates a 0 — it reads the localized no-data.
		expect(within(unnamed).getByText('No data')).toBeInTheDocument();
	});

	it('falls back to a localized unnamed title when the roll-up published no name', () => {
		render(HotspotsBoard);
		expect(screen.getByText('Item 24')).toBeInTheDocument();
	});

	it('keeps an unknown-type (non-linked) row a valid list item with no link', () => {
		// A row whose type maps to no detail page renders as a non-link list item —
		// it must still be a counted <li>, just without an enclosed link.
		payload.current = {
			generated_utc: '2026-06-18T07:00:00Z' as IsoUtc,
			hotspots: [
				{
					rank: 1,
					type: 'route',
					id: '161',
					name: 'Van Horne',
					otp_delta_pts: -12.4,
					severity: 'critical',
				},
				// Unknown discriminator → no nav target → a plain, non-linked list item.
				{
					rank: 2,
					type: 'corridor',
					id: 'C9',
					name: 'Plateau',
					otp_delta_pts: -4,
					severity: 'high',
				},
			],
		} satisfies Hotspots as Hotspots;
		render(HotspotsBoard);
		const list = screen.getByRole('list', { name: 'Hotspots ranked worst first' });
		// Two list items (both rows), but only the known route resolves to a link.
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
		expect(within(list).getAllByRole('link')).toHaveLength(1);
	});

	it('shows the honest empty state when the published list carries no hotspots', () => {
		payload.current = {
			generated_utc: '2026-06-18T07:00:00Z' as IsoUtc,
			hotspots: [],
		} satisfies Hotspots as Hotspots;
		render(HotspotsBoard);
		expect(screen.getByText('No hotspots published right now.')).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Hotspots ranked worst first' })).toBeNull();
	});
});
