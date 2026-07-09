import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripsFile } from '$lib/v1';
import TripDetail from './TripDetail.svelte';

// A live trips map (trip-keyed). t161 is broadcasting on route 161 with two
// remaining stops: sA carries a 4 min late prediction, sB carries a NULL delay
// (honest "no data", never 0). The absent-trip test looks up an id NOT here.
const TRIPS_FILE = {
	generated_utc: '2026-06-15T12:00:00Z',
	trips: {
		t161: {
			status: 'late',
			route: '161',
			delay_min: 4,
			stops: [
				{ stop: 'sA', eta_utc: '2026-06-15T12:05:00Z', delay_min: 4 },
				{ stop: 'sB', eta_utc: '2026-06-15T12:12:00Z', delay_min: null },
			],
		},
		// A broadcasting trip with NO remaining stops → the honest "no stops" note.
		tEmpty: {
			status: 'on_time',
			route: '24',
			delay_min: 0,
			stops: [],
		},
		// A broadcasting trip whose live row OMITS route + delay_min → the styled
		// honest-absence chip at both the route cell and the trip-level delay cell.
		tBlank: {
			status: 'unknown',
			route: null,
			delay_min: null,
			stops: [],
		},
	},
} as unknown as TripsFile;

// Mutable so individual tests can drive an absent / empty broadcast without
// re-mocking the module.
let tripsData: TripsFile | null = TRIPS_FILE;

// Mock $lib/v1 with a clean factory (importing the real barrel pulls the full
// module graph incl. $app/environment, which the jsdom env can't boot).
// getV1Context feeds the A4 CornerMeta corners (provider short_name); a minimal
// manifest stub is enough for the head to render.
vi.mock('$lib/v1', () => ({
	getTrips: vi.fn(),
	getV1Context: () => ({
		manifest: { short_name: 'STM', display_name: 'STM', dataset_version: 'test' },
	}),
}));

// createResource returns the trips file (or null) for the one trips read.
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		get data() {
			return tripsData;
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

// Mock the shared clock with a FIXED, skewed `serverNow` so the freshness age the
// FreshnessStamp renders is anchored to the SERVER clock (PR-6), not the raw
// client `Date.now()`. serverNow = the file's generated_utc + exactly 5 minutes →
// the chip must read "5 minutes ago" regardless of the machine's real clock. A
// drift-bugged readout (off Date.now()) would NOT land on that controlled value.
// serverNow = generated_utc (12:00:00Z) + 5 min → the stamp must read "5 minutes ago".
// Hoisted so the mock factories (also hoisted) can reference it. FreshnessStamp
// derives the age via $lib/v1/freshness → $lib/stores/clock.svelte, so mock the
// clock module too (not just the barrel) to pin the readout deterministically.
const clockStub = vi.hoisted(() => ({
	get now() {
		return Date.parse('2026-06-15T12:05:00Z');
	},
	get serverNow() {
		return Date.parse('2026-06-15T12:05:00Z');
	},
	subscribe: () => () => {},
}));
vi.mock('$lib/stores/clock.svelte', () => ({ sharedClock: clockStub }));
vi.mock('$lib/stores', () => ({ sharedClock: clockStub }));

beforeEach(() => {
	tripsData = TRIPS_FILE;
});

describe('TripDetail: a broadcasting trip', () => {
	it('renders the trip heading, route link, status and current delay', () => {
		render(TripDetail, { props: { id: 't161' } });

		expect(screen.getByRole('heading', { name: 'Trip t161' })).toBeInTheDocument();
		// Route links to the line detail page.
		expect(screen.getByRole('link', { name: 'View line 161' })).toHaveAttribute(
			'href',
			'/lines/161',
		);
		// Trip-level status reads honestly (the visible text channel, not colour-only).
		expect(screen.getByText('Late')).toBeInTheDocument();
		// "4 min late" appears at trip level AND on the matching stop; both are honest.
		expect(screen.getAllByText('4 min late').length).toBeGreaterThanOrEqual(1);
	});

	it('renders the wayfinding breadcrumb (Home > Trip {id}) with the leaf as current', () => {
		render(TripDetail, { props: { id: 't161' } });

		const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
		expect(nav).toBeInTheDocument();
		// Home links to the localized root; the trip leaf is the current page (not a link).
		expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
		const leaf = within(nav).getByText('Trip t161');
		expect(leaf).toHaveAttribute('aria-current', 'page');
		expect(within(nav).queryByRole('link', { name: 'Trip t161' })).toBeNull();
	});

	it('anchors the FreshnessStamp age to the SERVER clock (serverNow), not Date.now()', () => {
		render(TripDetail, { props: { id: 't161' } });

		// The chip's age derives from generated_utc (12:00:00Z) vs the mocked
		// sharedClock.serverNow (12:05:00Z) → exactly "5 minutes ago". This only
		// holds if the surface reads serverNow; an age off the raw client clock
		// would render whatever the wall clock minus 12:00Z happens to be.
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(within(chip).getByText('5 minutes ago')).toBeInTheDocument();
		// The machine-readable build stamp rides the <time datetime>, unchanged.
		expect(chip.querySelector('time')).toHaveAttribute('datetime', '2026-06-15T12:00:00Z');
	});

	it('frames each remaining-stop ETA as a live prediction with an honest delay basis', () => {
		render(TripDetail, { props: { id: 't161' } });

		const stops = screen.getByRole('list', { name: 'Remaining stops on this trip' });
		// Each remaining stop links to its detail page.
		expect(within(stops).getByRole('link', { name: 'View stop sA' })).toHaveAttribute(
			'href',
			'/stop/sA',
		);
		// The ETA is labelled a live PREDICTION, not a guarantee (every remaining stop).
		expect(within(stops).getAllByText('Live prediction').length).toBe(2);
	});

	it('shows the delay basis when present and the styled honest-absence chip when null, never 0', () => {
		render(TripDetail, { props: { id: 't161' } });

		const stops = screen.getByRole('list', { name: 'Remaining stops on this trip' });
		// sA has a 4 min late delay basis; sB has a null delay → the styled
		// honest-absence chip ("Unknown · not reported in the live feed"), never "0".
		expect(within(stops).getAllByText('4 min late').length).toBeGreaterThanOrEqual(1);
		const absent = within(stops).getByText('not reported in the live feed');
		expect(absent.closest('[data-slot="absent-value"]')).not.toBeNull();
		expect(within(stops).queryByText('0 min late')).not.toBeInTheDocument();
	});

	it('renders the styled honest-absence chip when a broadcasting trip omits route + delay', () => {
		render(TripDetail, { props: { id: 'tBlank' } });

		// The surface still renders (trip is broadcasting), with the route cell and the
		// trip-level delay cell both showing the styled honest-absence chip instead of
		// a plain easy-to-miss note. Both read 'not reported in the live feed'.
		expect(screen.getByRole('heading', { name: 'Trip tBlank' })).toBeInTheDocument();
		const chips = screen.getAllByText('not reported in the live feed');
		// Route cell + delay cell.
		expect(chips.length).toBe(2);
		for (const chip of chips) {
			expect(chip.closest('[data-slot="absent-value"]')).not.toBeNull();
		}
		// The old plain notes are gone (no bare grey text where the chip now lives).
		expect(screen.queryByText('No line reported')).not.toBeInTheDocument();
	});

	it('renders an honest note when a broadcasting trip reports no remaining stops', () => {
		render(TripDetail, { props: { id: 'tEmpty' } });

		expect(screen.getByTestId('trip-no-stops')).toBeInTheDocument();
		// No fabricated stop list.
		expect(
			screen.queryByRole('list', { name: 'Remaining stops on this trip' }),
		).not.toBeInTheDocument();
	});
});

describe('TripDetail: stand-down honesty', () => {
	it('stands down when the trip id is absent from the broadcast (ids rotate)', () => {
		render(TripDetail, { props: { id: 'tGhost' } });

		expect(screen.getByTestId('trip-standdown')).toBeInTheDocument();
		// Role+name query: SectionHeading glues [last word + dot] in a tail span
		// (DOT LAW), so the heading text spans multiple nodes; the accessible name
		// still reads whole (the aria-hidden dot is excluded).
		expect(screen.getByRole('heading', { name: 'Trip not broadcasting' })).toBeInTheDocument();
		// Never a fabricated trip heading / stop list.
		expect(screen.queryByRole('heading', { name: 'Trip tGhost' })).not.toBeInTheDocument();
	});

	it('stands down when getTrips yields no broadcast at all', () => {
		tripsData = null;
		render(TripDetail, { props: { id: 't161' } });

		// ResourceBoundary renders its empty edge state; no trip surface, no crash.
		expect(screen.queryByRole('heading', { name: 'Trip t161' })).not.toBeInTheDocument();
		expect(screen.queryByTestId('trip-standdown')).not.toBeInTheDocument();
	});
});
