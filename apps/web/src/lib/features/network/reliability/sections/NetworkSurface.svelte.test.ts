import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NetworkFile, NetworkShift, TrendPoint } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import NetworkSurface from './NetworkSurface.svelte';
import { networkReliabilityCopy } from '../network-reliability.copy';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

const copy = networkReliabilityCopy.en;
const motion = vi.hoisted(() => ({ reduced: false }));
const networkSource = () =>
	readFileSync(
		resolve(process.cwd(), 'src/lib/features/network/reliability/sections/NetworkSurface.svelte'),
		'utf-8',
	);
const detailShellSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/layout/DetailShell.svelte'), 'utf-8');
const networkTileSource = () =>
	readFileSync(
		resolve(process.cwd(), 'src/lib/features/network/reliability/sections/NetworkTile.svelte'),
		'utf-8',
	);
const liveHeadlineSource = () =>
	readFileSync(
		resolve(
			process.cwd(),
			'src/lib/features/network/reliability/sections/SectionLiveHeadline.svelte',
		),
		'utf-8',
	);

const networkManifest = vi.hoisted(() => ({ files: { live: { ttl_s: 30 } } }));
const createLiveStoreSpy = vi.hoisted(() => vi.fn());
const { openSurface, live, network, trendSeries, weeklySeries, monthlySeries, byShift, byDaytype } =
	vi.hoisted(() => ({
		openSurface: vi.fn(),
		live: { ageSeconds: 20 as number | null, hasNetwork: true },
		network: {
			generated_utc: '2026-06-16T02:00:00Z' as IsoUtc,
			vehicles_in_service: 10,
			on_time_pct: 80,
			status_dist: { early: 0, on_time: 8, late: 2, severe: 0, unknown: 0 },
			delay_p50_min: 1,
			delay_p90_min: 6,
			non_responding: 3,
			feed_freshness_s: 20,
			coverage_pct: 95,
			occupancy_mix: null,
			delay_histogram: [
				{ lo_min: null, hi_min: -5, count: 1 },
				{ lo_min: -5, hi_min: -2, count: 4 },
				{ lo_min: -2, hi_min: 0, count: 12 },
				{ lo_min: 0, hi_min: 2, count: 20 },
				{ lo_min: 2, hi_min: 5, count: 30 },
				{ lo_min: 5, hi_min: 10, count: 9 },
				{ lo_min: 10, hi_min: 15, count: 3 },
				{ lo_min: 15, hi_min: null, count: 2 },
			],
			non_responding_by_route: [
				{ route_id: '51', count: 2 },
				{ route_id: '105', count: 1 },
			],
		} satisfies NetworkFile as NetworkFile,
		trendSeries: [
			{
				date: '2026-06-14',
				otp_pct: 78,
				avg_delay_min: 2.1,
				p90_min: 5,
				vehicles: 9,
				cancellation_rate: 1.2,
				occupancy_mix: null,
			},
			{
				date: '2026-06-15',
				otp_pct: 81,
				avg_delay_min: 1.8,
				p90_min: 6,
				vehicles: 11,
				cancellation_rate: 2.6,
				occupancy_mix: {
					empty: 0.1,
					many_seats: 0.4,
					few_seats: 0.3,
					standing: 0.15,
					full: 0.05,
				},
			},
		] satisfies TrendPoint[] as TrendPoint[],
		weeklySeries: [
			{ date: '2026-06-01', otp_pct: 75, avg_delay_min: 2.4, p90_min: null, vehicles: null },
			{ date: '2026-06-08', otp_pct: 77, avg_delay_min: 2.2, p90_min: null, vehicles: null },
			{ date: '2026-06-15', otp_pct: 83, avg_delay_min: 1.6, p90_min: null, vehicles: null },
		] satisfies TrendPoint[] as TrendPoint[],
		monthlySeries: [
			{ date: '2026-04-01', otp_pct: 72, avg_delay_min: 2.8, p90_min: null, vehicles: null },
			{ date: '2026-05-01', otp_pct: 76, avg_delay_min: 2.5, p90_min: null, vehicles: null },
		] satisfies TrendPoint[] as TrendPoint[],
		byShift: [
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'pm_peak', otp_pct: 79, avg_delay_min: 2.6, severe_pct: 7.4 },
			{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
		] satisfies NetworkShift[] as NetworkShift[],
		byDaytype: [
			{ grain: 'weekday', otp_pct: 84, avg_delay_min: 1.9, severe_pct: 4.1 },
			{ grain: 'weekend', otp_pct: 81, avg_delay_min: 2.3, severe_pct: 6.2 },
		] satisfies NetworkShift[] as NetworkShift[],
	}));

vi.mock('$lib/nav', async () => {
	return {
		layout: { isDesktop: true },
		openSurface,
		routeFor: (t: { kind: string; id?: string; search?: string }) => {
			const base = t.kind === 'line' && t.id ? `/lines/${encodeURIComponent(t.id)}` : `/${t.kind}`;
			return t.search ? `${base}?${t.search}` : base;
		},
	};
});

vi.mock('$lib/motion/reduced-motion.svelte', () => ({
	prefersReducedMotion: {
		get current() {
			return motion.reduced;
		},
	},
	isPrefersReducedMotion: () => motion.reduced,
}));

vi.mock('$lib/v1', async () => {
	return {
		...(await import('$lib/v1/history')),
		STATUS_CODES: ['early', 'on_time', 'late', 'severe', 'unknown'],
		OCCUPANCY_CODES: ['empty', 'many_seats', 'few_seats', 'standing', 'full'],
		getV1Context: () => ({ manifest: networkManifest, labels: {}, lang: 'en' }),
		createLiveStore: (manifest: unknown, options?: unknown) => {
			createLiveStoreSpy(manifest, options);
			return {
				vehicles: null,
				trips: null,
				departures: null,
				alerts: null,
				network: live.hasNetwork ? network : null,
				index: {
					vehiclesById: new Map(),
					vehiclesByRoute: new Map(),
					vehiclesByTrip: new Map(),
					stopsById: new Map(),
					tripsById: new Map(),
					alertsById: new Map(),
				},
				generatedUtc: network.generated_utc,
				get ageSeconds() {
					return live.ageSeconds;
				},
				isStale: false,
				loading: false,
				error: null,
				start: vi.fn(),
				stop: vi.fn(),
				refresh: vi.fn(),
			};
		},
		getNetworkTrend: vi.fn(),
		getProvenance: vi.fn(),
		getNetworkHistoryIndex: vi.fn().mockResolvedValue(null),
		loadNetworkHistoryRange: vi.fn(),
	};
});

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (loader: () => unknown) => {
		const src = loader.toString();
		const isProvenance = src.includes('Provenance') || src.includes('provenance');
		return {
			data: isProvenance
				? { conformance: null }
				: {
						series: trendSeries,
						weekly: weeklySeries,
						monthly: monthlySeries,
						by_shift: byShift,
						by_daytype: byDaytype,
					},
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

beforeEach(() => {
	createLiveStoreSpy.mockClear();
	quietModeStore.resetForTest();
	sessionStorage.clear();
});

afterEach(() => {
	quietModeStore.resetForTest();
});

describe('NetworkSurface article shell', () => {
	it('requests only the network live family', () => {
		render(NetworkSurface);

		expect(createLiveStoreSpy).toHaveBeenCalledWith(networkManifest, {
			families: ['network'],
		});
	});

	it('keeps the live ToC anchor mounted while the live tier is still loading', () => {
		live.hasNetwork = false;
		try {
			const { container } = render(NetworkSurface);

			expect(container.querySelector('[data-toc="net-live"]')).not.toBeNull();
			expect(container.querySelector('[data-slot="terminal-panel"]')).toBeNull();
		} finally {
			live.hasNetwork = true;
		}
	});

	it('renders one ArticleHeader inside one DetailShell with one combined rail presentation', () => {
		const { container } = render(NetworkSurface);

		expect(container.querySelectorAll('[data-slot="detail-shell"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="article-header"]')).toHaveLength(1);
		expect(container.querySelectorAll('h1')).toHaveLength(1);
		expect(container.querySelectorAll('.detail-shell-tape')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="surface-rail"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="surface-rail-mobile"]')).toHaveLength(1);
		expect(screen.getByRole('heading', { level: 1, name: copy.heading })).toBeInTheDocument();
		expect(screen.getByText(copy.lede)).toBeInTheDocument();
		expect(container.querySelector('.network-content')).toContainElement(
			screen.getByText(copy.lede),
		);
		expect(container.querySelector('.header__meta')).toHaveTextContent(copy.article.sections(2));
		expect(container.querySelector('.header__meta time')).toHaveAttribute(
			'datetime',
			network.generated_utc,
		);
	});

	it('keeps the control-room terminal inside the collapsible live-headline card', async () => {
		const { container } = render(NetworkSurface);
		const terminal = container.querySelector('[data-slot="terminal-panel"]') as HTMLElement;
		const liveCard = container.querySelector(
			'[data-network-section="network-live-headline"] > [data-slot="card"]',
		) as HTMLElement;
		const liveBody = liveCard.querySelector('.section-body') as HTMLElement;

		expect(terminal).not.toBeNull();
		expect(liveCard).toContainElement(terminal);
		expect(liveBody).toContainElement(terminal);
		expect(within(terminal).getByText(copy.liveTerminal.title)).toBeInTheDocument();
		expect(terminal.querySelector('.terminal-tag')).toHaveTextContent(copy.liveTerminal.tag);
		expect(within(terminal).getByText(copy.liveTerminal.footerLabel)).toBeInTheDocument();
		expect(within(terminal).getByText(copy.liveTerminal.footerValue)).toBeInTheDocument();
		expect(container.querySelector('[data-toc="net-live"]')).toContainElement(terminal);
		expect(terminal.querySelector('[data-toc="net-live"]')).toBeNull();
		expect(container.querySelector('[data-toc="net-historic"]')).not.toBeNull();

		await fireEvent.click(within(liveCard).getByRole('button', { name: copy.liveSection }));
		expect(liveBody).toHaveAttribute('data-state', 'closed');
		expect(liveCard).toContainElement(terminal);
	});

	it('delegates the only active-section observer to DetailShell', () => {
		expect(networkSource()).not.toContain('observeActiveToc');
		expect(detailShellSource().match(/observeActiveToc\(/g)).toHaveLength(1);
	});

	it('delegates ToC target reveal to the shared helper', () => {
		expect(networkSource()).toContain('revealTocTarget');
		expect(networkSource()).not.toContain('document.querySelector(`[data-toc="${id}"]`)');
	});

	it('widens only the shared center cap while retaining the shared shell and terminal', () => {
		const source = networkSource();

		expect(source).toMatch(
			/\.network-detail[^{]*\{[\s\S]*?--detail-center-max:\s*var\(--container-wide\)/,
		);
		expect(source).not.toContain('--detail-rail-width:');
		expect(source).not.toContain('class="network-layout"');
		expect(liveHeadlineSource()).toContain('<TerminalPanel');
		expect(detailShellSource()).toContain('--detail-center-max: var(--container-content)');
	});

	it('renders the shared quiet-mode controls and wires every network section to collapse and expand', async () => {
		const { container } = render(NetworkSurface);
		const controls = screen.getByTestId('quiet-mode-controls');
		const headerContent = container.querySelector('.header__content') as HTMLElement;
		const actionRow = container.querySelector('[data-slot="article-header-actions"]');
		const controlRow = container.querySelector('[data-slot="article-header-controls"]');

		expect(within(controls).getAllByRole('button')).toHaveLength(2);
		expect(within(controls).getByRole('button', { name: /Collapse all/ })).toBeInTheDocument();
		expect(actionRow).not.toBeNull();
		expect(actionRow?.querySelector('[data-slot="freshness-stamp"]')).not.toBeNull();
		expect(controlRow).toContainElement(controls);
		expect(Array.from(headerContent.children).at(-1)).toBe(controlRow);

		const sectionTriggers = () =>
			Array.from(container.querySelectorAll<HTMLButtonElement>('[data-section-trigger]'));
		const sectionBodies = () =>
			Array.from(container.querySelectorAll<HTMLElement>('[data-network-section] .section-body'));
		expect(sectionTriggers().length).toBeGreaterThanOrEqual(10);
		expect(
			sectionTriggers().every((trigger) => trigger.getAttribute('aria-expanded') === 'true'),
		).toBe(true);

		await fireEvent.click(within(controls).getByRole('button', { name: /Collapse all/ }));
		await waitFor(() =>
			expect(
				sectionTriggers().every((trigger) => trigger.getAttribute('aria-expanded') === 'false'),
			).toBe(true),
		);
		expect(sectionBodies().every((body) => body.getAttribute('data-state') === 'closed')).toBe(
			true,
		);

		await fireEvent.click(within(controls).getByRole('button', { name: /Expand all/ }));
		await waitFor(() =>
			expect(
				sectionTriggers().every((trigger) => trigger.getAttribute('aria-expanded') === 'true'),
			).toBe(true),
		);
		expect(sectionBodies().every((body) => body.getAttribute('data-state') === 'open')).toBe(true);
	});

	it('gives every visible Network article card exactly one shared outer disclosure', async () => {
		const { container } = render(NetworkSurface);
		const expectedKeys = [
			'network-live-headline',
			'network-reporting',
			'network-status-mix',
			'network-delay-histogram',
			'network-daily-trend',
			'network-cancellations',
			'network-crowding-by-day',
			'network-service-completeness',
			'network-by-time-of-day',
			'network-weekday-weekend',
		];
		const sectionWrappers = Array.from(
			container.querySelectorAll<HTMLElement>('[data-network-section]'),
		);

		expect(sectionWrappers.map((section) => section.dataset.networkSection)).toEqual(expectedKeys);

		for (const wrapper of sectionWrappers) {
			const key = wrapper.dataset.networkSection;
			expect(wrapper, key).not.toBeNull();
			const card = wrapper.querySelector(':scope > [data-slot="card"]') as HTMLElement;
			expect(card, key).not.toBeNull();
			expect(card, key).toHaveAttribute('data-header-variant', 'article-summary');
			expect(card.querySelector('[data-network-section]'), key).toBeNull();
			const trigger = card.querySelector('[data-section-trigger]') as HTMLButtonElement;
			expect(trigger, key).toHaveAttribute('aria-expanded', 'true');
			expect(card.querySelector('[data-slot="chevron-toggle"]'), key).not.toBeNull();
		}

		const trend = container.querySelector(
			'[data-network-section="network-daily-trend"] > [data-slot="card"]',
		) as HTMLElement;
		await fireEvent.click(within(trend).getByRole('button', { name: copy.trendSection }));
		expect(sessionStorage.getItem('transit.persisted:network-daily-trend')).toBe('false');
	});

	it('uses the shared ArticleSectionStack rhythm for both primary card groups', () => {
		const { container } = render(NetworkSurface);
		const liveRegion = container.querySelector('[data-toc="net-live"]') as HTMLElement;
		const historicRegion = container.querySelector('[data-toc="net-historic"]') as HTMLElement;
		const liveStack = liveRegion.querySelector('.article-section-stack') as HTMLElement;
		const historicStack = historicRegion.querySelector('.article-section-stack') as HTMLElement;

		expect(liveStack).not.toBeNull();
		expect(liveStack).toContainElement(
			container.querySelector('[data-network-section="network-live-headline"]'),
		);
		expect(
			container.querySelector('[data-network-section="network-live-headline"]'),
		).toContainElement(container.querySelector('[data-slot="network-lede"]'));
		expect(historicStack).not.toBeNull();
		expect(historicStack).toContainElement(
			container.querySelector('[data-network-section="network-daily-trend"]'),
		);

		const source = networkSource();
		const localOuterStackRules =
			source.match(/\.network-(?:live-content|history-board|region)\s*\{[^}]*\}/g) ?? [];
		expect(localOuterStackRules.join('\n')).not.toMatch(/\bgap\s*:/);
		expect(source).toMatch(
			/\.network-history-companions\s*\{[^}]*gap:\s*var\(--space-card-gap\);/s,
		);
	});

	it('uses deterministic full-width history rows followed by one responsive companion row', () => {
		const { container } = render(NetworkSurface);
		const board = container.querySelector('[data-slot="network-history-board"]') as HTMLElement;

		expect(board).not.toBeNull();
		expect(Array.from(board.children).map((child) => child.getAttribute('data-slot'))).toEqual([
			'network-history-trend-row',
			'network-history-cancellations-row',
			'network-history-crowding-row',
			'network-history-companion-row',
		]);
		expect(
			board.querySelector(
				'[data-slot="network-history-trend-row"] [data-network-section="network-daily-trend"]',
			),
		).not.toBeNull();
		expect(
			board.querySelector(
				'[data-slot="network-history-cancellations-row"] [data-network-section="network-cancellations"]',
			),
		).not.toBeNull();
		expect(
			board.querySelector(
				'[data-slot="network-history-crowding-row"] [data-network-section="network-crowding-by-day"]',
			),
		).not.toBeNull();

		const companions = board.querySelector(
			'[data-slot="network-history-companion-row"]',
		) as HTMLElement;
		expect(companions).not.toBeNull();
		expect(companions).toHaveClass('network-history-companions');
		expect(
			companions.querySelector('[data-network-section="network-service-completeness"]'),
		).not.toBeNull();
		expect(
			companions.querySelector('[data-network-section="network-by-time-of-day"]'),
		).not.toBeNull();
		expect(
			companions.querySelector('[data-network-section="network-weekday-weekend"]'),
		).not.toBeNull();
	});

	it('removes Network-only hazard dividers and decorative glow from the card composition', () => {
		expect(networkSource()).not.toMatch(/<Separator\b/);
		expect(networkSource()).not.toMatch(/import\s+\{\s*Separator\s*\}/);
		expect(networkTileSource()).not.toMatch(/box-shadow\s*:|--shadow-card|drop-shadow\s*\(/);
		expect(networkTileSource()).not.toMatch(/height:\s*100%/);
	});
});

describe('NetworkSurface drilldown', () => {
	// P5.2: the cross-filter rides each band's spec `href` (a focusable SVG link
	// rendered by StackedShareBar) — the legacy onSelect callback is gone. LayerChart
	// paints nothing in happy-dom's zero-size containers (house pattern: marks are
	// asserted via their layout-independent sr-only tables; see the mark tests), so
	// these specs are proven here via the AT mirror; the href VALUES are pinned in
	// mixes.test.ts (hrefFor plumbing) and the band links are browser-verified.
	const rowFor = (container: HTMLElement, label: string): string | null => {
		for (const row of container.querySelectorAll('table.sr-only tbody tr')) {
			if (row.querySelector('th')?.textContent?.trim() === label)
				return row.querySelector('td')?.textContent?.trim() ?? null;
		}
		return null;
	};

	it('renders the status mix as a stacked-share mark (normalised shares in the AT mirror)', () => {
		const { container } = render(NetworkSurface);
		expect(rowFor(container as HTMLElement, 'Late')).toBe('20%');
	});

	it('renders the crowding mix as a stacked-share mark when telemetry exists', () => {
		network.occupancy_mix = {
			empty: 0.2,
			many_seats: 0.3,
			few_seats: 0.2,
			standing: 0.2,
			full: 0.1,
		};
		const { container } = render(NetworkSurface);
		expect(rowFor(container as HTMLElement, 'Standing')).toBe('20%');
		network.occupancy_mix = null;
	});
});

describe('NetworkSurface live cards (S9C)', () => {
	it('renders the four headline scalars as ExplainedMetricCards with the (i) affordance', () => {
		render(NetworkSurface);
		// The four glance cards each render an ExplainedMetricCard wrapper + the (i) info affordance.
		const cards = document.querySelectorAll('[data-slot="explained-metric-card"]');
		// four headline + two reporting + one cancellation latest = at least the four headline.
		expect(cards.length).toBeGreaterThanOrEqual(4);
		expect(
			document.querySelectorAll('[data-slot="explained-metric-info"]').length,
		).toBeGreaterThanOrEqual(4);
		// The on-time headline reads its real value inside a card's inner MetricDisplay.
		const otpTile = screen.getByText('Median delay').closest('[data-slot="explained-metric-card"]');
		expect(otpTile).not.toBeNull();
	});

	it('renders the styled honest-absence chip (not a plain "no data") for a null live tile', () => {
		network.delay_p50_min = null;
		render(NetworkSurface);
		const tile = screen
			.getByText('Median delay')
			.closest('[data-slot="metric-display"]') as HTMLElement;
		expect(tile).not.toBeNull();
		const chip = tile.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('aria-label')).toMatch(
			/not reported in the live feed/i,
		);
		expect(within(tile).queryByText('no data')).toBeNull();
		network.delay_p50_min = 1;
	});

	it('keeps a real measured 0% as a real value (never an absence chip)', () => {
		network.coverage_pct = 0;
		render(NetworkSurface);
		const tile = screen
			.getByText('Coverage')
			.closest('[data-slot="metric-display"]') as HTMLElement;
		expect(within(tile).getByText('0%')).toBeInTheDocument();
		expect(tile.querySelector('[data-slot="absent-value"]')).toBeNull();
		network.coverage_pct = 95;
	});

	it('surfaces the worker-feed-age chip near the FreshnessStamp', () => {
		render(NetworkSurface);
		const chip = screen.getByText('FEED').closest('[data-slot="feed-age"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('aria-label')).toContain('Worker feed updated');
	});

	it('ticks the feed age between polls by adding the live shared-clock delta', () => {
		live.ageSeconds = 40;
		render(NetworkSurface);
		const chip = screen.getByText('FEED').closest('[data-slot="feed-age"]') as HTMLElement;
		const value = chip.querySelector('.network-feed-age-value')?.textContent ?? '';
		expect(value).toMatch(/minute/i);
		expect(value).not.toMatch(/20 seconds/i);
		live.ageSeconds = 20;
	});

	it('keeps the feed age null (no chip) when feed_freshness_s is null', () => {
		network.feed_freshness_s = null;
		render(NetworkSurface);
		expect(document.querySelector('[data-slot="feed-age"]')).toBeNull();
		network.feed_freshness_s = 20;
	});
});

describe('NetworkSurface reporting row (S9C vehicles-reporting own row)', () => {
	it('groups vehicles-in-service + non_responding + the silent-lines list under its own section', () => {
		render(NetworkSurface);
		const section = document.querySelector('[data-slot="reporting-section"]') as HTMLElement;
		expect(section).not.toBeNull();
		// The non_responding total card + the vehicles card live in the reporting row.
		expect(within(section).getByText('Vehicles in service')).toBeInTheDocument();
		expect(within(section).getByText('Not reporting')).toBeInTheDocument();
		// The silent-by-route list lives inside the same section.
		const list = within(section).getByRole('list', {
			name: /scheduled trips currently running with no live vehicle/i,
		});
		expect(list).not.toBeNull();
	});

	it('states the global-signal caveat (per-line tally, not identifiable buses)', () => {
		render(NetworkSurface);
		const caveat = document.querySelector('[data-slot="reporting-caveat"]');
		expect(caveat).not.toBeNull();
		expect((caveat as HTMLElement).textContent).toMatch(/not identifiable buses/i);
	});

	it('renders a ranked list of silent lines, each deep-linking to /lines/[id]', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', {
			name: /scheduled trips currently running with no live vehicle/i,
		});
		const links = within(list).getAllByRole('link');
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute('href', '/lines/51');
		expect(links[0]).toHaveAttribute('aria-label', 'View line 51');
		expect(links[1]).toHaveAttribute('href', '/lines/105');
		expect(within(list).getByText('2 trips')).toBeInTheDocument();
		expect(within(list).getByText('1 trip')).toBeInTheDocument();
	});

	it('stands the silent list down when non_responding_by_route is null (scalar total remains)', () => {
		network.non_responding_by_route = null;
		render(NetworkSurface);
		expect(document.querySelector('[data-slot="non-responding-by-route"]')).toBeNull();
		// The reporting section still stands (the non_responding scalar card carries the total).
		expect(document.querySelector('[data-slot="reporting-section"]')).not.toBeNull();
		network.non_responding_by_route = [
			{ route_id: '51', count: 2 },
			{ route_id: '105', count: 1 },
		];
	});
});

describe('NetworkSurface delay distribution (ChartSpec re-seat)', () => {
	it('renders the histogram through the Chart kernel (its own mark slot) inside its full-width section', () => {
		render(NetworkSurface);
		const section = document.querySelector('[data-slot="delay-histogram-section"]');
		expect(section).not.toBeNull();
		const canvas = document.querySelector('[data-slot="delay-histogram"]');
		expect(canvas).not.toBeNull();
		// The Chart renders the A1 HistogramMark (not the old hand-rolled /max <ul>).
		expect(canvas!.querySelector('[data-slot="histogram-mark"]')).not.toBeNull();
		// The section is NOT nested inside a DashboardGrid cell (its own deliberate row).
		expect(canvas!.closest('[data-slot="dashboard-grid"]')).toBeNull();
	});

	it('carries all 8 signed-minute buckets in the mark sr-only table', () => {
		render(NetworkSurface);
		const mark = document.querySelector('[data-slot="histogram-mark"]') as HTMLElement;
		// The AT-fallback table carries EVERY bucket (incl. the clipped 15+ overflow bin).
		const rows = mark.querySelectorAll('table tbody tr');
		expect(rows).toHaveLength(8);
	});

	it('stands the histogram section down when delay_histogram is null', () => {
		network.delay_histogram = null;
		render(NetworkSurface);
		expect(document.querySelector('[data-slot="delay-histogram-section"]')).toBeNull();
		expect(document.querySelector('[data-slot="delay-histogram"]')).toBeNull();
		network.delay_histogram = [
			{ lo_min: null, hi_min: -5, count: 1 },
			{ lo_min: -5, hi_min: -2, count: 4 },
			{ lo_min: -2, hi_min: 0, count: 12 },
			{ lo_min: 0, hi_min: 2, count: 20 },
			{ lo_min: 2, hi_min: 5, count: 30 },
			{ lo_min: 5, hi_min: 10, count: 9 },
			{ lo_min: 10, hi_min: 15, count: 3 },
			{ lo_min: 15, hi_min: null, count: 2 },
		];
	});
});

describe('NetworkSurface trend window + series', () => {
	it('offers a 7/30/90-day trend window selector', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '7d' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: '30d' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeInTheDocument();
	});

	it('disables a window longer than the available series (2 days → 30d/90d disabled)', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '7d' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: '30d' })).toBeDisabled();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeDisabled();
	});

	it('offers a delay-series toggle (slowest 10% vs average)', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(group).getByRole('radio', { name: 'Slowest 10%' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Average' })).toBeInTheDocument();
	});

	it('preserves both delay choices on a sparse current singleton', () => {
		const original = trendSeries.slice();
		trendSeries.splice(
			0,
			trendSeries.length,
			{ date: '2026-06-14', otp_pct: 78, avg_delay_min: null, p90_min: null },
			{ date: '2026-06-15', otp_pct: 81, avg_delay_min: null, p90_min: null },
		);

		try {
			render(NetworkSurface);
			const group = screen.getByRole('radiogroup', { name: 'Delay series' });
			expect(within(group).getByRole('radio', { name: 'Slowest 10%' })).not.toBeDisabled();
			expect(within(group).getByRole('radio', { name: 'Average' })).not.toBeDisabled();
		} finally {
			trendSeries.splice(0, trendSeries.length, ...original);
		}
	});

	it('switches the retard channel from p90 to the mean series when "Average" is picked', async () => {
		// P5.2: TrendMark's sr-only table is the layout-independent read (LayerChart
		// paints nothing in happy-dom). The secondary column header carries the resolved
		// retard label; its cells carry the series.
		const { container } = render(NetworkSurface);
		const figure = container.querySelector('[data-slot="trend-mark"]') as HTMLElement;
		expect(figure).not.toBeNull();
		const secondaryHeader = () =>
			figure.querySelectorAll('table.sr-only thead th')[2]?.textContent ?? '';
		const lastY2 = () => {
			const rows = figure.querySelectorAll('table.sr-only tbody tr');
			// The daily fixture's last REAL reading sits on the second row (day 2 of 2 real).
			const cells = rows[1]?.querySelectorAll('td');
			return cells?.[1]?.textContent ?? '';
		};
		expect(secondaryHeader()).toContain('Slowest 10% (min)');
		expect(lastY2()).toBe('6');

		await fireEvent.click(screen.getByRole('radio', { name: 'Average' }));
		expect(secondaryHeader()).toContain('Average delay (min)');
		expect(secondaryHeader()).not.toContain('Slowest 10% (min)');
		expect(lastY2()).toBe('1.8');
	});
});

describe('NetworkSurface trend grain (day/week/month)', () => {
	const weeklyOriginal = weeklySeries.slice();
	const monthlyOriginal = monthlySeries.slice();
	afterEach(() => {
		weeklySeries.splice(0, weeklySeries.length, ...weeklyOriginal);
		monthlySeries.splice(0, monthlySeries.length, ...monthlyOriginal);
	});

	const trendFigure = (container: HTMLElement) =>
		container.querySelector('[data-slot="trend-mark"]') as HTMLElement;
	const trendRows = (container: HTMLElement) =>
		Array.from(trendFigure(container).querySelectorAll('table.sr-only tbody tr'));
	const rowY = (row: Element) => row.querySelectorAll('td')[0]?.textContent ?? '';

	it('offers a day/week/month grain picker when the coarse series carry data', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend grain' });
		expect(within(group).getByRole('radio', { name: 'Day' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Week' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Month' })).toBeInTheDocument();
	});

	it('switches the plotted series from daily to weekly when "Week" is picked (never flattened)', async () => {
		const { container } = render(NetworkSurface);
		const dayRows = trendRows(container);
		expect(dayRows).toHaveLength(2);
		expect(rowY(dayRows[dayRows.length - 1])).toBe('81');

		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		const weekRows = trendRows(container);
		expect(weekRows).toHaveLength(3);
		expect(rowY(weekRows[weekRows.length - 1])).toBe('83');
	});

	it('switches the plotted series to monthly when "Month" is picked', async () => {
		const { container } = render(NetworkSurface);
		await fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
		const monthRows = trendRows(container);
		expect(monthRows).toHaveLength(2);
		expect(rowY(monthRows[monthRows.length - 1])).toBe('76');
	});

	it('hides the daily-only marks under week/month (window picker, vehicles row, per-day crowding)', async () => {
		render(NetworkSurface);
		expect(screen.getByRole('radiogroup', { name: 'Trend window' })).toBeInTheDocument();
		expect(screen.getByRole('list', { name: /Crowding band mix per day/i })).toBeInTheDocument();
		expect(screen.getByText('Vehicles reporting each day')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		expect(screen.queryByRole('radiogroup', { name: 'Trend window' })).toBeNull();
		expect(screen.queryByRole('list', { name: /Crowding band mix per day/i })).toBeNull();
		expect(screen.queryByText('Vehicles reporting each day')).toBeNull();
	});

	it('disables the p90 delay segment on week/month (p90 is null there) and reads avg', async () => {
		const { container } = render(NetworkSurface);
		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		const delayGroup = screen.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(delayGroup).getByRole('radio', { name: 'Slowest 10%' })).toBeDisabled();
		expect(within(delayGroup).getByRole('radio', { name: 'Slowest 10%' })).not.toBeChecked();
		expect(within(delayGroup).getByRole('radio', { name: 'Average' })).toBeChecked();
		const header = trendFigure(container).querySelectorAll('table.sr-only thead th')[2];
		expect(header?.textContent).toContain('Average delay (min)');
		expect(header?.textContent).not.toContain('Slowest 10% (min)');
		const rows = trendRows(container);
		expect(rows[rows.length - 1].querySelectorAll('td')[1]?.textContent).toBe('1.6');
	});

	it('stands the grain picker down when no coarse series carries data', () => {
		weeklySeries.splice(0, weeklySeries.length);
		monthlySeries.splice(0, monthlySeries.length);
		render(NetworkSurface);
		expect(screen.queryByRole('radiogroup', { name: 'Trend grain' })).toBeNull();
		expect(screen.getByRole('radiogroup', { name: 'Trend window' })).toBeInTheDocument();
	});

	it('offers the grain picker when only weekly data exists (monthly empty)', () => {
		monthlySeries.splice(0, monthlySeries.length);
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend grain' });
		expect(within(group).getByRole('radio', { name: 'Week' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: 'Month' })).toBeDisabled();
	});
});

describe('NetworkSurface cancellation trend', () => {
	it('renders the cancellation block with the latest value when the series carries data', () => {
		render(NetworkSurface);
		const tile = screen.getByText('Canceled (latest day)').closest('[data-slot="metric-display"]');
		expect(tile).not.toBeNull();
		expect(within(tile as HTMLElement).getByText('2.6%')).toBeInTheDocument();
	});
});

describe('NetworkSurface per-day crowding', () => {
	it('renders a per-day crowding small-multiple skipping days with no telemetry', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /Crowding band mix per day/i });
		expect(within(list).getByText('Jun 15')).toBeInTheDocument();
		expect(within(list).queryByText('Jun 14')).toBeNull();
	});
});

describe('NetworkSurface by time of day + weekday/weekend', () => {
	afterEach(() => {
		byShift.splice(
			0,
			byShift.length,
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'pm_peak', otp_pct: 79, avg_delay_min: 2.6, severe_pct: 7.4 },
			{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
		);
		byDaytype.splice(
			0,
			byDaytype.length,
			{ grain: 'weekday', otp_pct: 84, avg_delay_min: 1.9, severe_pct: 4.1 },
			{ grain: 'weekend', otp_pct: 81, avg_delay_min: 2.3, severe_pct: 6.2 },
		);
	});

	it('leads each by-time-of-day row with the real OTP %, ranked worst-punctuality first', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		const rows = within(list).getAllByText(/peak/i);
		expect(rows[0]).toHaveTextContent('PM peak');
		expect(rows[1]).toHaveTextContent('AM peak');
		expect(within(list).getByText('79%')).toBeInTheDocument();
		expect(within(list).getByText('88%')).toBeInTheDocument();
		expect(within(list).getByText(/avg delay 2\.6 min · severe 7\.4%/i)).toBeInTheDocument();
	});

	it('drops a shift grain with no OTP and no severe share (no fabricated 0)', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		expect(within(list).queryByText('Night')).toBeNull();
	});

	it('keeps a null-OTP grain (real severe share) and shows the styled honest-absence chip, never a fake 0%', () => {
		byShift.splice(
			0,
			byShift.length,
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'midday', otp_pct: null, avg_delay_min: 2.0, severe_pct: 9.0 },
		);
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		const midday = within(list)
			.getByText('Midday')
			.closest('[data-slot="ranked-row"]') as HTMLElement;
		expect(midday).not.toBeNull();
		const chip = midday.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('aria-label')).toMatch(/not enough readings/i);
		expect(within(midday).queryByText('0%')).toBeNull();
	});

	it('renders the weekday-vs-weekend list worst-punctuality first (weekend before weekday)', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /weekdays versus weekends/i });
		const weekend = within(list).getByText('Weekend');
		const weekday = within(list).getByText('Weekday');
		expect(
			weekend.compareDocumentPosition(weekday) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(within(list).getByText('81%')).toBeInTheDocument();
		expect(within(list).getByText('84%')).toBeInTheDocument();
	});

	it('prints the honest trailing-window caveat under the readout', () => {
		render(NetworkSurface);
		const caveat = document.querySelector('[data-slot="shift-caveat"]');
		expect(caveat).not.toBeNull();
		expect((caveat as HTMLElement).textContent).toMatch(/not certified/i);
	});

	it('stands the whole section down when by_shift + by_daytype are both empty', () => {
		byShift.splice(0, byShift.length);
		byDaytype.splice(0, byDaytype.length);
		render(NetworkSurface);
		expect(screen.queryByText('By time of day')).toBeNull();
		expect(screen.queryByText('Weekday vs weekend')).toBeNull();
		expect(document.querySelector('[data-slot="network-shift"]')).toBeNull();
	});

	it('shows only the day-type list when by_shift is empty but by_daytype has data', () => {
		byShift.splice(0, byShift.length);
		render(NetworkSurface);
		expect(screen.queryByText('By time of day')).toBeNull();
		expect(screen.getByText('Weekday vs weekend')).toBeInTheDocument();
		expect(document.querySelector('[data-slot="network-shift"]')).not.toBeNull();
	});
});

describe('NetworkSurface trend window re-slice', () => {
	const original = trendSeries.slice();
	// Unique dates (TrendMark keys its sr-table rows by xLabel — real series never repeat a day).
	const longSeries = Array.from({ length: 40 }, (_, i) => ({
		date: `2026-${String(5 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
		otp_pct: 70 + (i % 20),
		avg_delay_min: 1 + (i % 5),
		p90_min: 4 + (i % 6),
		vehicles: 100 + i,
		cancellation_rate: null,
		occupancy_mix: null,
	}));

	beforeEach(() => {
		trendSeries.splice(0, trendSeries.length, ...longSeries);
	});
	afterEach(() => {
		trendSeries.splice(0, trendSeries.length, ...original);
	});

	it('re-slices the trend to fewer plotted days when 7d is picked after the 30d default', async () => {
		const { container } = render(NetworkSurface);
		const rowsFor = () =>
			container.querySelectorAll('[data-slot="trend-mark"] table.sr-only tbody tr');

		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '30d' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeDisabled();
		expect(rowsFor()).toHaveLength(30);

		await fireEvent.click(within(group).getByRole('radio', { name: '7d' }));
		expect(rowsFor()).toHaveLength(7);
	});
});

describe('NetworkSurface OTP trend zoom (S9B min-span domain + reference)', () => {
	// P5.2: the zoom VALUE lives in the selector-emitted spec (LayerChart draws the axis
	// only in a real layout); the floored-span + clamp behaviour is pinned in
	// trendChart.test.ts against otpTrendDomain, and the rendered axis is browser-verified.
	it('mounts the trend as the spec-driven TrendMark (the S9B zoom rides the spec domain)', () => {
		const { container } = render(NetworkSurface);
		const figure = container.querySelector('[data-slot="trend-mark"]') as HTMLElement;
		expect(figure).not.toBeNull();
		// The sr-only table (the AT mirror) carries both series for every plotted day.
		expect(figure.querySelectorAll('table.sr-only tbody tr').length).toBeGreaterThanOrEqual(2);
	});
});

describe('NetworkSurface service completeness (S9B GC2 ramp-in)', () => {
	const original = trendSeries.slice();
	afterEach(() => {
		trendSeries.splice(0, trendSeries.length, ...original);
	});

	it('renders the completeness tile WITH its honest-absence note when every rate is null (B4)', () => {
		// The base fixture carries no service_completeness_rate → the tile stays rendered
		// and says why the value is absent (no data + why, never a missing section).
		render(NetworkSurface);
		const tile = document.querySelector('[data-slot="completeness-section"]') as HTMLElement;
		expect(tile).not.toBeNull();
		expect(tile.textContent).toContain('No data yet');
	});

	it('stands the completeness tile UP with the latest served rate when data accrues', () => {
		trendSeries.splice(
			0,
			trendSeries.length,
			{ ...original[0], service_completeness_rate: 91 },
			{ ...original[1], service_completeness_rate: 94.2 },
		);
		render(NetworkSurface);
		const tile = document.querySelector('[data-slot="completeness-section"]') as HTMLElement;
		expect(tile).not.toBeNull();
		expect(within(tile).getByText('Scheduled service delivered')).toBeInTheDocument();
		expect(within(tile).getByText('94.2%')).toBeInTheDocument();
		// The always-visible explainer carries the silent-trip framing.
		expect(within(tile).getByText(/never appears in the live feed/i)).toBeInTheDocument();
	});
});

describe('NetworkSurface — map-style GLASS LEFT RAIL (P5.4)', () => {
	it('uses instant ToC navigation when reduced motion is requested', async () => {
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		const scrollIntoView = vi.fn();
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: scrollIntoView,
		});
		motion.reduced = true;

		try {
			const { container } = render(NetworkSurface);
			const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			await fireEvent.click(within(rail).getByRole('button', { name: copy.historicRegion }));
			await waitFor(() =>
				expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' }),
			);
		} finally {
			motion.reduced = false;
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
		}
	});

	it('renders ONE mobile pill labelled with the View heading + the active grain', () => {
		const { container } = render(NetworkSurface);
		// The SurfaceRail mobile pill replaces the old top-rail SurfaceControls + ControlsRail.
		const railMobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		expect(railMobile).not.toBeNull();
		const pillBtn = railMobile.querySelector('button') as HTMLButtonElement;
		expect(pillBtn).not.toBeNull();
		// Labelled with the View heading + the active grain (default 'day' → Day).
		expect(pillBtn.textContent).toContain(copy.viewControlsLabel);
		expect(pillBtn.textContent).toContain(copy.grain.day);
		// The sheet is closed by default (no dialog rendered yet).
		expect(railMobile.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens ONE sheet with BOTH the view controls AND the region ToC on tap', async () => {
		const { container } = render(NetworkSurface);
		const railMobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pillBtn = railMobile.querySelector('button') as HTMLButtonElement;
		await fireEvent.click(pillBtn);
		expect(pillBtn.getAttribute('aria-expanded')).toBe('true');
		const sheet = railMobile.querySelector('[role="dialog"]') as HTMLElement;
		expect(sheet).not.toBeNull();
		// The ONE sheet merges the view controls (the delay-series toggle) AND the region ToC.
		expect(within(sheet).getByRole('radiogroup', { name: 'Delay series' })).toBeInTheDocument();
		expect(sheet.querySelector('[data-slot="section-toc"]')).not.toBeNull();
	});

	it('keeps the one ToC disclosure remembered while its rail moves into the sheet', async () => {
		const storageKey = 'transit.persisted:network-toc';
		sessionStorage.removeItem(storageKey);
		const { container } = render(NetworkSurface);
		const desktopToc = container.querySelector(
			'[data-slot="surface-rail"] [data-slot="section-toc"]',
		) as HTMLElement;
		const desktopToggle = within(desktopToc).getByRole('button', { name: copy.rail.toc });

		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		const mobileToc = (mobile.querySelector('[role="dialog"]') as HTMLElement).querySelector(
			'[data-slot="section-toc"]',
		) as HTMLElement;
		const mobileToggle = within(mobileToc).getByRole('button', { name: copy.rail.toc });
		expect(mobileToggle).toBe(desktopToggle);

		await fireEvent.click(mobileToggle);

		expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
		expect(desktopToggle).toHaveAttribute('aria-expanded', 'false');
		expect(sessionStorage.getItem(storageKey)).toBe('false');
	});

	it('keeps one disabled-grain reason and one described radio as the rail moves', async () => {
		const original = monthlySeries.slice();
		monthlySeries.splice(0, monthlySeries.length);

		try {
			const { container } = render(NetworkSurface);
			const railMobile = container.querySelector(
				'[data-slot="surface-rail-mobile"]',
			) as HTMLElement;
			await fireEvent.click(railMobile.querySelector('button') as HTMLButtonElement);

			const reasons = Array.from(
				container.querySelectorAll<HTMLElement>('[data-slot="controls-reason"]'),
			);
			const reasonIds = reasons.map((reason) => reason.id);
			expect(reasonIds).toHaveLength(1);
			expect(new Set(reasonIds).size).toBe(reasonIds.length);
			expect(reasonIds[0]).toMatch(/-(?:desktop|mobile)$/);

			const monthRadios = screen.getAllByRole('radio', { name: copy.grain.month });
			expect(monthRadios).toHaveLength(1);
			expect(monthRadios[0]?.getAttribute('aria-describedby')).toBe(reasonIds[0]);
			for (const radio of monthRadios) {
				const describedBy = radio.getAttribute('aria-describedby');
				expect(describedBy).not.toBeNull();
				expect(container.querySelector(`#${describedBy}`)).not.toBeNull();
			}
		} finally {
			monthlySeries.splice(0, monthlySeries.length, ...original);
		}
	});

	it('minted a two-region ToC (Live now + Historic trend) on the shared TocNav', () => {
		const { container } = render(NetworkSurface);
		// The two minted anchors carry data-toc so the observer + the ToC jump buttons resolve.
		expect(container.querySelector('[data-toc="net-live"]')).not.toBeNull();
		expect(container.querySelector('[data-toc="net-historic"]')).not.toBeNull();
		// The rail region jump-list now rides the ONE shared TocNav (button-driven), not the
		// old bespoke ↻/∞ anchor nav.
		const toc = container.querySelector('[data-slot="section-toc"]') as HTMLElement;
		expect(toc).not.toBeNull();
		const items = Array.from(toc.querySelectorAll('.toc-item'));
		expect(items.length).toBeGreaterThanOrEqual(2);
		const labels = items.map((b) => b.textContent ?? '');
		expect(labels.some((l) => l.includes(copy.liveRegion))).toBe(true);
		expect(labels.some((l) => l.includes(copy.historicRegion))).toBe(true);
		// The old per-region scope glyph is gone — no ↻/∞ anywhere in the rail ToC.
		expect(toc.textContent).not.toMatch(/[↻∞]/);
	});
});

describe('NetworkSurface canonical article-control stack', () => {
	it('orders label, history, primary grain, and secondary controls before the section ToC', () => {
		const component = networkSource();
		const tag = component.match(/<ArticleControlStack[\s\S]*?\/>/)?.[0] ?? '';
		const primary =
			component.match(/{#snippet primaryControls\(\)}([\s\S]*?){\/snippet}/)?.[1] ?? '';

		expect(tag).not.toBe('');
		expect(tag.indexOf('label=')).toBeLessThan(tag.indexOf('history='));
		expect(tag.indexOf('history=')).toBeLessThan(tag.indexOf('primary='));
		expect(tag.indexOf('primary=')).toBeLessThan(tag.indexOf('secondary='));
		expect(tag).not.toContain('caption=');
		expect(primary).toContain('variant="time-grid"');
		expect(component.indexOf('data-slot="section-toc"')).toBeGreaterThan(
			component.indexOf('<ArticleControlStack'),
		);
		expect(component).not.toMatch(/class=["']network-control-body/);
		expect(component).not.toMatch(/\.network-control-body\s*\{/);
	});
});
