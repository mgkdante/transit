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
				// Honesty fixture: a null OTP delta → OMITTED display value (no "no data"
				// string) + a null (no-data) magnitude bar, never a fabricated 0. Unknown
				// severity → quiet 'watch' band, never a guessed 'critical'.
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

	it('omits the delta display entirely for a row whose OTP delta is absent', () => {
		render(HotspotsBoard);
		const unnamed = screen.getByRole('link', { name: 'View detail for Item 24' });
		expect(unnamed).toBeInTheDocument();
		// The null-delta row neither fabricates a 0 NOR reads a permanent "no data"
		// placeholder — its display value is omitted (RankedRow only renders
		// {#if display}), so the all-null delta column simply disappears.
		expect(within(unnamed).queryByText('No data')).toBeNull();
		expect(within(unnamed).queryByText(/on-time points lost/)).toBeNull();
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

	it("per-cell null delta drops that row's magnitude bar but keeps a band-hint row", () => {
		render(HotspotsBoard);
		// rank 1 + 2 carry magnitudes → real SeverityBar progressbars; rank 3 is null
		// → NO bar, a band-hint row instead. So exactly 2 progressbars, 1 band row.
		expect(screen.getAllByRole('progressbar')).toHaveLength(2);
		const bandRows = document.querySelectorAll('[data-slot="hotspot-band-row"]');
		expect(bandRows).toHaveLength(1);
		// The band row reads the REAL ranked severity ('mystery' → quiet 'watch'),
		// never a fabricated 0 bar.
		expect(screen.getByText('Severity: Watch')).toBeInTheDocument();
	});

	it('when the WHOLE magnitude column is null: ranked rows + honest note + NO fake bar', () => {
		// The LIVE state the operator flagged — every otp_delta_pts absent. The rank +
		// name + severity + worst-first order are REAL, so all rows render; but not a
		// single magnitude bar is drawn (an empty track reads broken), and the heading
		// carries the localized "magnitude unavailable" note.
		payload.current = {
			generated_utc: '2026-06-18T07:00:00Z' as IsoUtc,
			hotspots: [
				{
					rank: 1,
					type: 'route',
					id: '161',
					name: 'Van Horne',
					otp_delta_pts: null,
					severity: 'critical',
				},
				{
					rank: 2,
					type: 'stop',
					id: '57191',
					name: 'Berri / Fleury',
					otp_delta_pts: null,
					severity: 'high',
				},
				{
					rank: 3,
					type: 'route',
					id: '24',
					name: 'Sherbrooke',
					otp_delta_pts: null,
					severity: 'watch',
				},
			],
		} satisfies Hotspots as Hotspots;
		render(HotspotsBoard);
		// All three ranked rows still render (the ranking is real).
		const list = screen.getByRole('list', { name: 'Hotspots ranked worst first' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(3);
		// The honest note replaces the magnitude caption.
		expect(screen.getByText('Magnitude unavailable, ranked by severity.')).toBeInTheDocument();
		// NOT a single magnitude bar (no fake/empty tracks): zero progressbars.
		expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
		// Each row falls back to its REAL severity-band hint.
		expect(screen.getByText('Severity: Critical')).toBeInTheDocument();
		expect(screen.getByText('Severity: High')).toBeInTheDocument();
		expect(screen.getByText('Severity: Watch')).toBeInTheDocument();
	});

	it('keeps the real-data path: a fully-populated column still renders magnitude bars', () => {
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
			],
		} satisfies Hotspots as Hotspots;
		render(HotspotsBoard);
		// Every row carries a magnitude → a real SeverityBar progressbar each, and the
		// standard "relative to the worst case" caption (not the unavailable note).
		expect(screen.getAllByRole('progressbar')).toHaveLength(2);
		expect(
			screen.getByText('The bar shows the problem size relative to the worst case.'),
		).toBeInTheDocument();
		expect(screen.queryByText('Magnitude unavailable, ranked by severity.')).toBeNull();
		expect(document.querySelectorAll('[data-slot="hotspot-band-row"]')).toHaveLength(0);
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
