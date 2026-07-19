import { render, fireEvent, waitFor, within } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StopReliability, IsoUtc } from '$lib/v1';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

const motion = vi.hoisted(() => ({ reduced: false }));

// Seed the grain rail from ?grain on load + mirror it back. Mock the SvelteKit page URL
// (mutable) + a replaceState that UPDATES it, so the seed, availability clamp, AND the
// round-trip mirror (incl. the day default-omit) are testable — the same harness the
// RouteReliabilityClusters urlseed test uses.
let mockUrl = new URL('http://localhost/stop/57191');
const replaceState = vi.hoisted(() =>
	vi.fn((u: string | URL) => {
		mockUrl = new URL(u, 'http://localhost');
	}),
);
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mockUrl;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ replaceState }));
vi.mock('$lib/v1', async () => ({
	...(await import('$lib/v1/history')),
	wilsonBounds: (await import('$lib/v1/stats')).wilsonBounds,
}));
vi.mock('@yesid/motion/stores/reducedMotion', () => ({
	prefersReducedMotion: {
		subscribe(run: (value: boolean) => void) {
			run(motion.reduced);
			return () => {};
		},
	},
	isPrefersReducedMotion: () => motion.reduced,
}));

import StopReliabilitySurface from './StopReliabilitySurface.svelte';

const utc = (v: string): IsoUtc => v as IsoUtc;
const source = () =>
	readFileSync(
		resolve(
			process.cwd(),
			'src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte',
		),
		'utf-8',
	);

// day + week periods (NO month) + a dated daily series so the trend/verdict render.
const data: StopReliability = {
	generated_utc: utc('2026-06-19T02:00:00Z'),
	id: '57191',
	periods: [
		{ grain: 'day', p50_min: 2.4, p90_min: 11.6, otp_pct: 82 },
		{ grain: 'week', otp_pct: 71, avg_delay_min: 3.3 },
	],
	daily: [
		{
			date: '2026-06-01',
			observation_count: 40,
			severe_count: 4,
			severe_pct: 10,
			avg_delay_min: 1.5,
		},
		{
			date: '2026-06-02',
			observation_count: 60,
			severe_count: 9,
			severe_pct: 15,
			avg_delay_min: 2.1,
		},
		{
			date: '2026-06-03',
			observation_count: 50,
			severe_count: 5,
			severe_pct: 10,
			avg_delay_min: 1.8,
		},
	],
	by_route: [{ route: '51', avg_delay_min: 6 }],
};

// P5.4: the grain radiogroup now lives in the responsive SurfaceRail,
// which renders the SAME rail snippet in BOTH the bare desktop rail
// ([data-slot="surface-rail"]) AND the mobile pill→sheet. Scope to the desktop rail's
// radiogroup for an unambiguous query (jsdom renders both, so an unscoped role query is
// ambiguous).
const desktopGroup = (c: HTMLElement): HTMLElement => {
	const rail = c.querySelector('[data-slot="surface-rail"]') as HTMLElement;
	return rail.querySelector('[role="radiogroup"]') as HTMLElement;
};

const PRESENT_SECTIONS = [
	['stop-rel-trend', 'Daily trend'],
	['stop-rel-percentiles', 'Daily delay'],
	['stop-rel-pane', 'On-time and delay'],
	['stop-rel-crowding', 'Crowding on buses seen here'],
	['stop-rel-by-route', 'Avg delay by route'],
] as const;

const disclosure = (container: HTMLElement, id: string): HTMLElement =>
	container.querySelector(`[data-toc="${id}"]`) as HTMLElement;

const disclosureTrigger = (container: HTMLElement, id: string, name: string): HTMLElement =>
	within(disclosure(container, id)).getByRole('button', { name });

beforeEach(() => {
	quietModeStore.resetForTest();
	sessionStorage.clear();
	motion.reduced = false;
});

describe('StopReliabilitySurface — grain seed + availability (S8A)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/stop/57191');
		replaceState.mockClear();
	});

	it('offers only grains the stop has data for; day is the default (richest)', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const group = desktopGroup(container);
		const day = within(group).getByRole('radio', { name: 'Day' });
		const week = within(group).getByRole('radio', { name: 'Week' });
		const month = within(group).getByRole('radio', { name: 'Month' });
		expect(day).toBeEnabled();
		expect(week).toBeEnabled();
		expect(month).toBeDisabled(); // no month period → disabled, never selectable
		expect(day).toHaveAttribute('aria-checked', 'true');
	});

	it('seeds the rail from ?grain=week', () => {
		mockUrl = new URL('http://localhost/stop/57191?grain=week');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		expect(week).toHaveAttribute('aria-checked', 'true');
	});

	it('clamps an UNAVAILABLE seeded grain (month) back to day', () => {
		mockUrl = new URL('http://localhost/stop/57191?grain=month');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const day = within(desktopGroup(container)).getByRole('radio', { name: 'Day' });
		expect(day).toHaveAttribute('aria-checked', 'true');
	});

	it('falls back to day for an unknown ?grain (enum-guard, never a cast)', () => {
		mockUrl = new URL('http://localhost/stop/57191?grain=bogus');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const checked = desktopGroup(container).querySelectorAll('[role="radio"][aria-checked="true"]');
		expect(checked.length).toBe(1);
		expect(checked[0].textContent?.trim()).toBe('Day');
	});

	it('day percentiles surface only on the day grain (drop on week, no fabricated 0)', async () => {
		const { container, queryByText } = render(StopReliabilitySurface, {
			props: { data, locale: 'en' },
		});
		expect(queryByText('Typical delay')).not.toBeNull();
		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		await fireEvent.click(week);
		expect(queryByText('Typical delay')).toBeNull();
	});

	it('mirrors a grain change to ?grain and OMITS the day default (clean URL)', async () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		expect(replaceState).not.toHaveBeenCalled(); // idempotent default-omit on a clean URL

		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		await fireEvent.click(week);
		expect(mockUrl.searchParams.get('grain')).toBe('week');

		const day = within(desktopGroup(container)).getByRole('radio', { name: 'Day' });
		await fireEvent.click(day);
		expect(mockUrl.searchParams.get('grain')).toBeNull(); // day default deleted, never grain=day
	});

	it('preserves an existing ?tab when mirroring grain (mirror merges, single-key)', async () => {
		mockUrl = new URL('http://localhost/stop/57191?tab=reliability');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		await fireEvent.click(week);
		expect(mockUrl.searchParams.get('grain')).toBe('week');
		expect(mockUrl.searchParams.get('tab')).toBe('reliability'); // ?tab untouched
	});
});

describe('StopReliabilitySurface — responsive left-rail structure (P5.4)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/stop/57191');
		replaceState.mockClear();
	});

	it('uses the shared ReliabilityRailLayout without a local desktop grid', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });

		expect(container.querySelectorAll('[data-slot="reliability-rail-layout"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="surface-rail"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="reliability-rail-content"]')).toHaveLength(1);
		expect(source()).toContain('<ReliabilityRailLayout');
		expect(source()).not.toContain('class="stop-reliability-layout"');
		expect(source()).not.toMatch(/grid-template-columns:[^;]*16rem/);
	});

	it('forwards an optional article summary into the shared centered summary lane', () => {
		const component = source();

		expect(component).toContain('articleSummary?: Snippet;');
		expect(component).toMatch(/<ReliabilityRailLayout[\s\S]*?\{articleSummary\}[\s\S]*?\/>/);
	});

	it('uses instant ToC navigation when reduced motion is requested', async () => {
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		const scrollIntoView = vi.fn();
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: scrollIntoView,
		});
		motion.reduced = true;

		try {
			const { container } = render(StopReliabilitySurface, {
				props: { data, locale: 'en' },
			});
			const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			await fireEvent.click(within(rail).getByRole('button', { name: 'Daily trend' }));
			await waitFor(() =>
				expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' }),
			);
		} finally {
			motion.reduced = false;
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
		}
	});

	it('renders the SurfaceRail: a bare desktop rail + a mobile pill that opens a dialog sheet', async () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		// The bare desktop rail holds the grain radiogroup + the section ToC.
		const railPanel = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(railPanel).not.toBeNull();
		expect(railPanel.querySelector('[data-slot="section-toc"]')).not.toBeNull();

		// Mobile pill → ONE dialog sheet (grain + ToC merged).
		const pill = container.querySelector(
			'[data-slot="surface-rail-mobile"] button',
		) as HTMLButtonElement;
		expect(pill).not.toBeNull();
		expect(container.querySelector('[role="dialog"]')).toBeNull(); // closed by default
		await fireEvent.click(pill);
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();
	});

	it('keeps the one ToC disclosure remembered while its rail moves into the sheet', async () => {
		const storageKey = 'transit.persisted:stop-reliability-toc';
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const desktopToc = container.querySelector(
			'[data-slot="surface-rail"] [data-slot="section-toc"]',
		) as HTMLElement;
		const desktopToggle = within(desktopToc).getByRole('button', {
			name: 'Jump to a section',
		});

		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		const mobileToc = (mobile.querySelector('[role="dialog"]') as HTMLElement).querySelector(
			'[data-slot="section-toc"]',
		) as HTMLElement;
		const mobileToggle = within(mobileToc).getByRole('button', {
			name: 'Jump to a section',
		});
		expect(mobileToggle).toBe(desktopToggle);

		await fireEvent.click(mobileToggle);

		expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
		expect(desktopToggle).toHaveAttribute('aria-expanded', 'false');
		expect(sessionStorage.getItem(storageKey)).toBe('false');
	});

	it('lists ONLY the present sections in the ToC (drops stood-down sections)', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		// The rail section jump-list now rides the shared TocNav (button-driven .toc-item rows
		// carrying a .toc-label title), not bespoke <a href> anchors.
		const toc = container.querySelector(
			'[data-slot="surface-rail"] [data-slot="section-toc"]',
		) as HTMLElement;
		expect(toc).not.toBeNull();
		const labels = Array.from(toc.querySelectorAll('.toc-item .toc-label')).map((el) =>
			el.textContent?.trim(),
		);
		// Present: trend + percentiles (day grain) + pane + crowding + by-route.
		expect(labels).toContain('Daily trend');
		expect(labels).toContain('Daily delay'); // day percentiles
		expect(labels).toContain('On-time and delay'); // pane
		expect(labels).toContain('Crowding on buses seen here');
		expect(labels).toContain('Avg delay by route');
		// Absent from the fixture (no habits / day_of_week / shift periods) → not listed.
		expect(labels).not.toContain('Severe delays by hour'); // habits
		expect(labels).not.toContain('By day of week');
		expect(labels).not.toContain('By time of day');
		// The old ↻/∞ per-row scope glyph is gone.
		expect(toc.textContent).not.toContain('↻');
		expect(toc.textContent).not.toContain('∞');
	});

	it('drops the percentiles ToC entry on the week grain (percentiles stand down)', async () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		await fireEvent.click(week);
		const toc = container.querySelector(
			'[data-slot="surface-rail"] [data-slot="section-toc"]',
		) as HTMLElement;
		const labels = Array.from(toc.querySelectorAll('.toc-item .toc-label')).map((el) =>
			el.textContent?.trim(),
		);
		expect(labels).not.toContain('Daily delay'); // day-only percentiles gone
	});

	it('keeps the visible route metric in each Line link accessible name', () => {
		const view = render(StopReliabilitySurface, { props: { data, locale: 'en' } });

		expect(
			view.getByRole('link', {
				name: (name) => name.includes('View line 51') && name.includes('6.0 min'),
			}),
		).toHaveAttribute('href', '/lines/51');
	});
});

describe('StopReliabilitySurface — cohesive article disclosures', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/stop/57191');
		replaceState.mockClear();
	});

	it('gives every present ToC data section one disclosure controlled by global collapse/expand', async () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });

		for (const [id, label] of PRESENT_SECTIONS) {
			expect(disclosureTrigger(container, id, label)).toHaveAttribute('aria-expanded', 'true');
		}

		quietModeStore.toggle();
		await waitFor(() => {
			for (const [id, label] of PRESENT_SECTIONS) {
				expect(disclosureTrigger(container, id, label)).toHaveAttribute('aria-expanded', 'false');
			}
		});
		expect(
			container.querySelector('[data-slot="surface-rail"] [data-slot="section-toc"]'),
		).toBeVisible();

		quietModeStore.toggle();
		await waitFor(() => {
			for (const [id, label] of PRESENT_SECTIONS) {
				expect(disclosureTrigger(container, id, label)).toHaveAttribute('aria-expanded', 'true');
			}
		});
	});

	it('keeps every conditional disclosure in one connected vertical stack', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const stack = container.querySelector('[data-slot="article-section-stack"]') as HTMLElement;
		const anchors = Array.from(stack?.children ?? []);

		expect(stack).not.toBeNull();
		expect(anchors).toHaveLength(PRESENT_SECTIONS.length);
		for (const anchor of anchors) {
			expect(anchor.matches('.stop-anchor')).toBe(true);
			expect(
				anchor.querySelector(':scope > [data-slot="card"].section-card[data-toc]'),
			).not.toBeNull();
			expect(anchor.querySelector('[data-section-trigger]')).not.toBeNull();
		}
		expect(container.querySelector('[data-slot="dashboard-grid"]')).toBeNull();
	});

	it('lets one disclosure collapse without changing the next card in the sequence', async () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const route = disclosure(container, 'stop-rel-by-route');
		const routeTrigger = within(route).getByRole('button', { name: 'Avg delay by route' });
		const routeBody = route.querySelector('[data-slot="collapsible-content"]');
		const crowdingTrigger = disclosureTrigger(
			container,
			'stop-rel-crowding',
			'Crowding on buses seen here',
		);

		await fireEvent.click(routeTrigger);

		expect(routeBody).toHaveAttribute('data-state', 'closed');
		expect(crowdingTrigger).toHaveAttribute('aria-expanded', 'true');
		expect(route.closest('[data-slot="article-section-stack"]')).not.toBeNull();
	});

	it('removes the old local reliability stack gap and DashboardGrid composition', () => {
		const component = source();

		expect(component).toContain('ArticleSectionStack');
		expect(component).not.toContain('DashboardGrid');
		expect(component).toMatch(
			/\.stop-reliability-content\s*\{[^}]*gap:\s*var\(--space-card-gap\);/s,
		);
		expect(component).not.toMatch(/\.stop-reliability-content\s*\{[^}]*gap:\s*1\.25rem/s);
	});

	it('restores the remembered collapsed default after a clean remount', async () => {
		const first = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		quietModeStore.rememberCurrent();
		await waitFor(() =>
			expect(disclosureTrigger(first.container, 'stop-rel-trend', 'Daily trend')).toHaveAttribute(
				'aria-expanded',
				'false',
			),
		);
		first.unmount();

		// Prove the site-wide remembered default owns the remount, not a per-card
		// session value left behind by the first render.
		sessionStorage.clear();
		quietModeStore.init();
		const second = render(StopReliabilitySurface, { props: { data, locale: 'en' } });

		await waitFor(() => {
			for (const [id, label] of PRESENT_SECTIONS) {
				expect(disclosureTrigger(second.container, id, label)).toHaveAttribute(
					'aria-expanded',
					'false',
				);
			}
		});
	});

	it('reveals a collapsed ToC target before scrolling to it', async () => {
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		let trigger: HTMLElement;
		const scrollIntoView = vi.fn(() => {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		});
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: scrollIntoView,
		});
		motion.reduced = true;
		quietModeStore.toggle();

		try {
			const { container } = render(StopReliabilitySurface, {
				props: { data, locale: 'en' },
			});
			trigger = disclosureTrigger(container, 'stop-rel-trend', 'Daily trend');
			expect(trigger).toHaveAttribute('aria-expanded', 'false');

			const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			await fireEvent.click(within(rail).getByRole('button', { name: 'Daily trend' }));

			await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
			await waitFor(() =>
				expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' }),
			);
		} finally {
			motion.reduced = false;
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
		}
	});

	it('gives every article section one card and one heading without parent CSS suppression', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const component = source();

		for (const [id, label] of PRESENT_SECTIONS) {
			const card = disclosure(container, id);

			expect(within(card).getByRole('button', { name: label })).toBeInTheDocument();
			expect(card).toHaveAttribute('data-slot', 'card');
			expect(card.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
			expect(card.querySelectorAll('h2')).toHaveLength(1);
			expect(card.querySelector('.stop-tile')).toBeNull();
		}

		expect(component).not.toMatch(/section-card \.stop-tile/);
		expect(component).not.toMatch(/:global\(\.stop-tile-heading\)/);
	});
});

describe('StopReliabilitySurface — daily trend + range verdict (S8A)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/stop/57191');
		replaceState.mockClear();
	});

	it('mounts the daily-trend section with the presenter window seam', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		expect(container.querySelector('[data-slot="stop-daily-trend"]')).not.toBeNull();
		// The S8B mount seam is present (a {from,to} window prop drives it).
		expect(container.querySelector('[data-mount="daily-range"]')).not.toBeNull();
	});

	it('pools the FULL window verdict EXACTLY (Σcounts → 12.0%, 150 obs)', () => {
		const { getByText } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		// pooled severe = 100*18/150 = 12.0% (a value equal to no single day's rate).
		expect(getByText('12.0%')).toBeInTheDocument();
		expect(getByText('150')).toBeInTheDocument(); // observation count tile
	});

	it('clips the trend + verdict to a {from,to} window prop (S8B seam)', () => {
		const { getByText } = render(StopReliabilitySurface, {
			props: { data, locale: 'en', window: { from: '2026-06-01', to: '2026-06-02' } },
		});
		// pooled over 2 days: 100*13/100 = 13.0%, 100 obs.
		expect(getByText('13.0%')).toBeInTheDocument();
		expect(getByText('100')).toBeInTheDocument();
	});
});

describe('StopReliabilitySurface canonical article-control stack', () => {
	it('orders label, history range, primary grain, and caption before the section ToC', () => {
		const component = source();
		const tag = component.match(/<ArticleControlStack[\s\S]*?\/>/)?.[0] ?? '';
		const primary =
			component.match(/{#snippet primaryControls\(\)}([\s\S]*?){\/snippet}/)?.[1] ?? '';

		expect(tag).not.toBe('');
		expect(tag.indexOf('label=')).toBeLessThan(tag.indexOf('history='));
		expect(tag.indexOf('history=')).toBeLessThan(tag.indexOf('primary='));
		expect(tag.indexOf('primary=')).toBeLessThan(tag.indexOf('caption='));
		expect(tag).not.toContain('secondary=');
		expect(primary).toContain('variant="time-grid"');
		expect(component.indexOf('data-slot="section-toc"')).toBeGreaterThan(
			component.indexOf('<ArticleControlStack'),
		);
		expect(component).not.toMatch(/class=["']stop-reliability-control-body/);
		expect(component).not.toMatch(/\.stop-reliability-control-body\s*\{/);
	});
});
