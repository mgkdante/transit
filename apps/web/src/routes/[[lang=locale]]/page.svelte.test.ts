// Home hub page — control-room hero + what-this-is + grouped surface board.
//
// Covers the load-bearing behaviors the redesign introduced:
//   · identity render (display_name from the booted manifest)
//   · the LIVE PULSE honesty contract — stands down to the localized "no data"
//     glyph when the live store is null (SSR / before the first tick / absent
//     live tier), and reads real headline numbers when network.json reports
//   · EXPLORE EVERYTHING wayfinding — all three groups + every surface entry,
//     primary surfaces routing via openSurface, reference surfaces as localized
//     <a> links
//   · bilingual copy (EN + FR) off the same component
//
// The hub reads getV1Context().manifest + createLiveStore + getLocale; we mock
// $lib/v1 (a controllable live network) and $lib/i18n (the locale under test)
// the same way the NetworkHealth surface test does, and $lib/nav for openSurface.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkFile } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import Page from './+page.svelte';

const { openSurface, state } = vi.hoisted(() => ({
	openSurface: vi.fn(),
	// A mutable harness: `locale` drives the i18n mock, `network` is the live
	// store payload (null = stood-down live tier). Tests flip these per case.
	state: {
		locale: 'en' as 'en' | 'fr',
		network: null as NetworkFile | null,
	},
}));

const manifest = {
	provider: 'demo',
	display_name: 'Demo Transit',
	short_name: 'Demo',
	city: 'Testville',
	dataset_version: 'v-test',
	files: {
		live: { generated_utc: '2026-06-20T12:00:00Z', ttl_s: 30 },
		static: { generated_utc: '2026-06-20T06:00:00Z' },
	},
};

vi.mock('$lib/i18n', async () => {
	return {
		getLocale: () => state.locale,
		// The hub builds reference-surface hrefs with localizeHref; mirror the real
		// '/fr' prefix convention so the FR link-href assertions are honest.
		localizeHref: (path: string, locale: 'en' | 'fr') =>
			locale === 'fr' ? `/fr${path === '/' ? '' : path}` : path,
	};
});

vi.mock('$lib/nav', async () => {
	return { openSurface };
});

vi.mock('$lib/v1', async () => {
	return {
		getV1Context: () => ({ manifest, labels: {}, lang: state.locale }),
		createLiveStore: () => ({
			vehicles: null,
			trips: null,
			departures: null,
			alerts: null,
			network: state.network,
			index: {},
			generatedUtc: state.network?.generated_utc ?? null,
			ageSeconds: state.network ? 12 : null,
			isStale: false,
			loading: false,
			error: null,
			start: vi.fn(),
			stop: vi.fn(),
			refresh: vi.fn(),
		}),
	};
});

const liveNetwork: NetworkFile = {
	generated_utc: '2026-06-20T12:00:00Z' as IsoUtc,
	vehicles_in_service: 412,
	on_time_pct: 83,
	status_dist: { early: 0, on_time: 8, late: 2, severe: 0, unknown: 0 },
	delay_p50_min: 1,
	delay_p90_min: 6,
	non_responding: 7,
	feed_freshness_s: 20,
	coverage_pct: 94,
	occupancy_mix: null,
};

afterEach(() => {
	state.locale = 'en';
	state.network = null;
	openSurface.mockClear();
});

describe('Home hub — identity + what-this-is', () => {
	it('renders the provider identity as the page heading', () => {
		render(Page);
		expect(screen.getByRole('heading', { level: 1, name: /Demo Transit/i })).toBeInTheDocument();
	});

	it('templates the what-this-is copy on the manifest short_name + city (provider-agnostic)', () => {
		render(Page);
		// Identity tokens template into the copy (tagline + body both carry them),
		// never a hardcoded agency.
		expect(screen.getAllByText(/Demo network across Testville/i).length).toBeGreaterThanOrEqual(1);
		// The honesty contract line is unique to the what-this-is body.
		expect(screen.getByText(/Never a fabricated zero\./i)).toBeInTheDocument();
		expect(screen.getByText(/a measured proxy, not certified OTP/i)).toBeInTheDocument();
		// The "How we measure" deep links (the prose link + the trust tile) point at
		// /metrics.
		const measureLinks = screen.getAllByRole('link', { name: /How we measure/i });
		expect(measureLinks.length).toBeGreaterThanOrEqual(1);
		for (const link of measureLinks) expect(link).toHaveAttribute('href', '/metrics');
	});
});

describe('Home hub — live pulse honesty', () => {
	it('stands the pulse down to "no data" (never a fabricated 0) when the live store is null', () => {
		state.network = null;
		render(Page);
		const board = screen.getByRole('list', { name: /the network, right now/i });
		// Every headline reads the honest no-data glyph; no fabricated 0 / 0%.
		expect(within(board).getAllByText('no data').length).toBeGreaterThanOrEqual(4);
		expect(within(board).queryByText('0%')).toBeNull();
		expect(within(board).queryByText('0')).toBeNull();
		// The pulse verdict reads STANDBY when the live tier is absent (the terminal
		// tag + the dot's sr-only label both carry it).
		expect(screen.getAllByText('STANDBY').length).toBeGreaterThanOrEqual(1);
		// The freshness chip stands its age down to "unknown" with no live build.
		expect(screen.getByText('unknown')).toBeInTheDocument();
	});

	it('reads real headline numbers when the live tier reports', () => {
		state.network = liveNetwork;
		render(Page);
		const board = screen.getByRole('list', { name: /the network, right now/i });
		expect(within(board).getByText('83%')).toBeInTheDocument(); // on-time
		expect(within(board).getByText('412')).toBeInTheDocument(); // vehicles in service
		expect(within(board).getByText('7')).toBeInTheDocument(); // not reporting
		expect(within(board).getByText('94%')).toBeInTheDocument(); // coverage
		// The pulse verdict flips to LIVE when the tier reports (no STANDBY anywhere).
		expect(screen.getAllByText('LIVE').length).toBeGreaterThanOrEqual(1);
		expect(screen.queryByText('STANDBY')).toBeNull();
	});
});

describe('Home hub — explore everything wayfinding', () => {
	it('renders all three surface groups', () => {
		render(Page);
		const nav = screen.getByRole('navigation', { name: /explore everything/i });
		expect(within(nav).getByRole('heading', { name: 'Explore' })).toBeInTheDocument();
		expect(within(nav).getByRole('heading', { name: 'Accountability' })).toBeInTheDocument();
		expect(within(nav).getByRole('heading', { name: 'Trust' })).toBeInTheDocument();
	});

	it('routes a primary surface tile through openSurface', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Live map/i }));
		expect(openSurface).toHaveBeenCalledExactlyOnceWith({ kind: 'map' });
	});

	it('renders reference surfaces as localized <a> links (accountability + trust)', () => {
		render(Page);
		expect(screen.getByRole('link', { name: /Hotspots/i })).toHaveAttribute('href', '/hotspots');
		expect(screen.getByRole('link', { name: /Daily receipt/i })).toHaveAttribute(
			'href',
			'/receipt',
		);
		expect(screen.getByRole('link', { name: /Repeat offenders/i })).toHaveAttribute(
			'href',
			'/repeat-offenders',
		);
		expect(screen.getByRole('link', { name: /Alerts/i })).toHaveAttribute('href', '/alerts');
		expect(screen.getByRole('link', { name: /Data health/i })).toHaveAttribute('href', '/status');
	});

	it('exposes every surface so the hub no longer hides the audit pages', () => {
		render(Page);
		// 5 primary surfaces are interactive buttons (map, lines, stops, network, search).
		// 6 reference surfaces are links (4 accountability + how-we-measure + data-health).
		// The page's interactive entries must cover the full surface inventory.
		const buttons = screen.getAllByRole('button').filter((b) => b.classList.contains('hub-tile'));
		const links = screen.getAllByRole('link').filter((a) => a.classList.contains('hub-tile'));
		expect(buttons).toHaveLength(5);
		expect(links).toHaveLength(6);
	});
});

describe('Home hub — bilingual', () => {
	beforeEach(() => {
		state.locale = 'fr';
	});

	it('renders the FR copy + FR-prefixed reference hrefs', () => {
		render(Page);
		expect(screen.getAllByText(/Le réseau Demo de Testville/i).length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText(/Jamais de zéro inventé\./i)).toBeInTheDocument();
		// FR group labels.
		const nav = screen.getByRole('navigation', { name: /tout explorer/i });
		expect(within(nav).getByRole('heading', { name: 'Explorer' })).toBeInTheDocument();
		expect(within(nav).getByRole('heading', { name: 'Confiance' })).toBeInTheDocument();
		// Reference links carry the /fr prefix.
		const mesureLinks = screen.getAllByRole('link', { name: /Comment on mesure/i });
		expect(mesureLinks.length).toBeGreaterThanOrEqual(1);
		for (const link of mesureLinks) expect(link).toHaveAttribute('href', '/fr/metrics');
		expect(screen.getByRole('link', { name: /Santé des données/i })).toHaveAttribute(
			'href',
			'/fr/status',
		);
	});
});
