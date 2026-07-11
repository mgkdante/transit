import { render, screen, within, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hotspots, IsoUtc } from '$lib/v1/schemas';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

// Mock the SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the ?grain
// / ?n seed and the round-trip mirror remain covered while the page changes shells.
let mockUrl = new URL('http://localhost/hotspots');
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

const { payload } = vi.hoisted(() => ({ payload: { current: null as Hotspots | null } }));

vi.mock('$lib/v1', () => ({ getHotspots: vi.fn() }));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: payload.current,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

import HotspotsBoard from './HotspotsBoard.svelte';
import { copy as hotspotsCopy } from './hotspots.copy';

// A populated day ladder (both kinds + one tray) and a populated week ladder, so
// the article has all three cards and the combined rail offers its grain control.
function seed(): Hotspots {
	return {
		generated_utc: '2026-06-25T00:00:00Z' as IsoUtc,
		hotspots: [],
		by_grain: [
			{
				grain: 'day',
				date: '2026-06-24',
				window_end: '2026-06-24',
				entries: [
					{
						rank: 1,
						type: 'stop',
						id: 'S1',
						name: 'Berri-UQAM',
						severe_pct: 70,
						observation_count: 80,
						wilson_lo: 16.8,
						wilson_hi: 30.1,
						otp_delta_pts: -20,
						avg_delay_min: 6.7,
					},
					{ rank: 2, type: 'route', id: '51', severe_pct: 40, observation_count: 100 },
				],
				tray: [
					{
						rank: null,
						type: 'stop',
						id: 'S2',
						name: 'Quiet Ave',
						severe_pct: 5,
						observation_count: 12,
					},
					{
						rank: null,
						type: 'route',
						id: 'R2',
						name: 'Sparse Route',
						severe_pct: 4,
						observation_count: null,
					},
					{
						rank: null,
						type: 'route',
						id: 'R3',
						name: 'Zero Route',
						severe_pct: 0,
						observation_count: 0,
					},
				],
			},
			{
				grain: 'week',
				date: '2026-06-14',
				window_end: '2026-06-20',
				entries: [
					{
						rank: 1,
						type: 'route',
						id: '161',
						name: 'Van Horne',
						severe_pct: 55,
						observation_count: 200,
					},
				],
				tray: [],
			},
		],
	} satisfies Hotspots as Hotspots;
}

function routeOnlySeed(count = 1): Hotspots {
	return {
		generated_utc: '2026-06-25T00:00:00Z' as IsoUtc,
		hotspots: [],
		by_grain: [
			{
				grain: 'day',
				date: '2026-06-24',
				window_end: '2026-06-24',
				entries: Array.from({ length: count }, (_, i) => ({
					rank: i + 1,
					type: 'route',
					id: `R${i}`,
					name: `Route ${i}`,
					severe_pct: 50 - i,
					observation_count: 100,
				})),
				tray: [],
			},
		],
	} satisfies Hotspots as Hotspots;
}

function largeSeed(): Hotspots {
	const fixture = routeOnlySeed(6);
	const entries = fixture.by_grain?.[0]?.entries;
	if (!entries) throw new Error('largeSeed requires a day ladder');
	entries.push({
		rank: 7,
		type: 'stop',
		id: 'S7',
		name: 'Station Seven',
		severe_pct: 30,
		observation_count: 100,
	});
	fixture.by_grain?.push({
		grain: 'week',
		entries: [{ rank: 1, type: 'route', id: 'W1', severe_pct: 25, observation_count: 100 }],
		tray: [],
	});
	return fixture;
}

function card(container: HTMLElement, id: string): HTMLElement {
	return container.querySelector(`[data-toc="${id}"]`) as HTMLElement;
}

function cardTrigger(container: HTMLElement, id: string): HTMLButtonElement {
	return card(container, id).querySelector(
		'h2.section-heading > button.section-header',
	) as HTMLButtonElement;
}

function resetHotspotsState(): void {
	for (const key of ['hotspots-card-top', 'hotspots-card-lines', 'hotspots-card-stops']) {
		sessionStorage.removeItem(`transit.persisted:${key}`);
	}
	sessionStorage.removeItem('transit.persisted:hotspots-controls');
	sessionStorage.removeItem('transit.persisted:hotspots-toc');
	quietModeStore.resetForTest();
}

describe('HotspotsBoard article', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/hotspots');
		replaceState.mockClear();
		payload.current = seed();
		resetHotspotsState();
		Element.prototype.scrollIntoView = vi.fn();
	});

	afterEach(resetHotspotsState);

	it('renders one article h1 and only the exact two QuietModeButton controls', () => {
		const { container } = render(HotspotsBoard);
		expect(screen.getAllByRole('heading', { level: 1, name: 'Hotspots' })).toHaveLength(1);
		const controls = screen.getByTestId('quiet-mode-controls');
		expect(within(controls).getAllByRole('button')).toHaveLength(2);
		expect(within(controls).getByRole('button', { name: /Collapse all/ })).toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-shell"]')).not.toBeNull();
	});

	it('renders Top hotspot, Lines, and Stops as simultaneous article-summary cards without tabs', () => {
		const { container } = render(HotspotsBoard);
		const cards = ['hotspots-top', 'hotspots-lines', 'hotspots-stops'].map((id) =>
			card(container, id),
		);
		expect(cards.every(Boolean)).toBe(true);
		expect(cards.map((el) => el.getAttribute('data-header-variant'))).toEqual([
			'article-summary',
			'article-summary',
			'article-summary',
		]);
		expect(cards.map((el) => el.querySelector('[data-slot="badge"]')?.textContent?.trim())).toEqual(
			['01', '02', '03'],
		);
		expect(container.querySelector('[role="tablist"]')).toBeNull();
		expect(container.querySelector('[role="tab"]')).toBeNull();
		expect(
			within(card(container, 'hotspots-lines')).getByRole('link', { name: /51/ }),
		).toHaveAttribute('href', '/lines/51');
		expect(
			within(card(container, 'hotspots-stops')).getByRole('link', { name: /Berri-UQAM/ }),
		).toHaveAttribute('href', '/stop/S1');
	});

	it('omits the Stops card and Stops TOC destination for a route-only grain', () => {
		payload.current = routeOnlySeed();
		const { container } = render(HotspotsBoard);
		expect(card(container, 'hotspots-lines')).not.toBeNull();
		expect(container.querySelector('[data-toc="hotspots-stops"]')).toBeNull();
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getByRole('button', { name: 'Lines' })).toBeInTheDocument();
		expect(within(rail).queryByRole('button', { name: 'Stops' })).toBeNull();
	});

	it('puts two rail disclosures, grain, useful top-N, window, and TOC in one mobile sheet', async () => {
		payload.current = largeSeed();
		const { container } = render(HotspotsBoard);
		expect(container.querySelectorAll('[data-slot="surface-rail-mobile"]')).toHaveLength(1);
		expect(container.querySelector('[data-slot="toc-pill"]')).toBeNull();

		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector(':scope > button') as HTMLButtonElement;
		await fireEvent.click(pill);
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		expect(sheet).not.toBeNull();
		expect(within(sheet).getByRole('button', { name: 'View controls' })).toBeInTheDocument();
		expect(within(sheet).getByRole('button', { name: 'On this page' })).toBeInTheDocument();
		expect(
			within(sheet).getAllByRole('button', { name: /^(View controls|On this page)$/ }),
		).toHaveLength(2);
		expect(sheet.querySelectorAll('[data-slot="grain-picker"]')).toHaveLength(2);
		expect(sheet.querySelector('[data-slot="active-window"]')).not.toBeNull();
		expect(within(sheet).getByRole('button', { name: 'Top hotspot' })).toBeInTheDocument();
		expect(within(sheet).getByRole('button', { name: 'Lines' })).toBeInTheDocument();
		expect(within(sheet).getByRole('button', { name: 'Stops' })).toBeInTheDocument();

		const reasonIds = Array.from(
			container.querySelectorAll<HTMLElement>('[data-slot="controls-reason"]'),
		).map((reason) => reason.id);
		expect(reasonIds).toHaveLength(4);
		expect(new Set(reasonIds)).toHaveLength(4);
		expect(reasonIds.some((id) => id.endsWith('-desktop'))).toBe(true);
		expect(reasonIds.some((id) => id.endsWith('-mobile'))).toBe(true);
	});

	it('keeps rail disclosures independent, persisted, and synchronized across presentations', async () => {
		const { container } = render(HotspotsBoard);
		const desktop = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const controls = within(desktop).getByRole('button', { name: 'View controls' });
		const toc = within(desktop).getByRole('button', { name: 'On this page' });

		await fireEvent.click(controls);
		expect(controls).toHaveAttribute('aria-expanded', 'false');
		expect(toc).toHaveAttribute('aria-expanded', 'true');
		expect(sessionStorage.getItem('transit.persisted:hotspots-controls')).toBe('false');

		await fireEvent.click(toc);
		expect(sessionStorage.getItem('transit.persisted:hotspots-toc')).toBe('false');

		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector(':scope > button') as HTMLButtonElement;
		await fireEvent.click(pill);
		let sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		let mobileControls = within(sheet).getByRole('button', { name: 'View controls' });
		let mobileToc = within(sheet).getByRole('button', { name: 'On this page' });
		expect(mobileControls).toHaveAttribute('aria-expanded', 'false');
		expect(mobileToc).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.click(mobileControls);
		expect(controls).toHaveAttribute('aria-expanded', 'true');
		expect(toc).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.click(pill);
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
		await fireEvent.click(pill);
		sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		mobileControls = within(sheet).getByRole('button', { name: 'View controls' });
		mobileToc = within(sheet).getByRole('button', { name: 'On this page' });
		expect(mobileControls).toHaveAttribute('aria-expanded', 'true');
		expect(mobileToc).toHaveAttribute('aria-expanded', 'false');
	});

	it('restores one manual rail choice across a full same-tab board remount', async () => {
		const first = render(HotspotsBoard);
		const firstDesktop = first.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const firstControls = within(firstDesktop).getByRole('button', { name: 'View controls' });
		const firstToc = within(firstDesktop).getByRole('button', { name: 'On this page' });

		await waitFor(() => expect(firstControls).toHaveAttribute('aria-expanded', 'true'));
		expect(firstToc).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(firstControls);
		expect(sessionStorage.getItem('transit.persisted:hotspots-controls')).toBe('false');
		expect(firstToc).toHaveAttribute('aria-expanded', 'true');

		first.unmount();
		const second = render(HotspotsBoard);
		const secondDesktop = second.container.querySelector(
			'[data-slot="surface-rail"]',
		) as HTMLElement;
		const secondControls = within(secondDesktop).getByRole('button', { name: 'View controls' });
		const secondToc = within(secondDesktop).getByRole('button', { name: 'On this page' });

		await waitFor(() => expect(secondControls).toHaveAttribute('aria-expanded', 'false'));
		expect(secondToc).toHaveAttribute('aria-expanded', 'true');
		expect(sessionStorage.getItem('transit.persisted:hotspots-controls')).toBe('false');
	});

	it('Collapse all closes every card and Expand all reopens every card', async () => {
		const { container } = render(HotspotsBoard);
		const ids = ['hotspots-top', 'hotspots-lines', 'hotspots-stops'];
		const desktop = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const railTriggers = [
			within(desktop).getByRole('button', { name: 'View controls' }),
			within(desktop).getByRole('button', { name: 'On this page' }),
		];
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'true');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'true');

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'false');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'true');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Collapse all');
	});

	it('Always start collapsed closes both rail blocks and every article card', async () => {
		const { container } = render(HotspotsBoard);
		const desktop = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const railTriggers = [
			within(desktop).getByRole('button', { name: 'View controls' }),
			within(desktop).getByRole('button', { name: 'On this page' }),
		];

		await fireEvent.click(screen.getByTestId('quiet-mode-remember'));

		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'false');
		for (const id of ['hotspots-top', 'hotspots-lines', 'hotspots-stops']) {
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');
		}
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');
	});

	it('reapplies remembered quiet mode across a full board remount', async () => {
		const first = render(HotspotsBoard);
		const firstDesktop = first.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const firstControls = within(firstDesktop).getByRole('button', { name: 'View controls' });

		await fireEvent.click(screen.getByTestId('quiet-mode-remember'));
		await fireEvent.click(firstControls);
		expect(firstControls).toHaveAttribute('aria-expanded', 'true');
		expect(sessionStorage.getItem('transit.persisted:hotspots-controls')).toBe('true');
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');

		first.unmount();
		const second = render(HotspotsBoard);
		const secondDesktop = second.container.querySelector(
			'[data-slot="surface-rail"]',
		) as HTMLElement;
		const secondControls = within(secondDesktop).getByRole('button', { name: 'View controls' });
		const secondToc = within(secondDesktop).getByRole('button', { name: 'On this page' });

		await waitFor(() => expect(secondControls).toHaveAttribute('aria-expanded', 'false'));
		expect(secondToc).toHaveAttribute('aria-expanded', 'false');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');
	});

	it('applies remembered bulk collapse when Stops mounts after a same-page grain change', async () => {
		localStorage.setItem('transit:quiet-mode', 'true');
		mockUrl = new URL('http://localhost/hotspots?grain=week');
		const { container } = render(HotspotsBoard);
		expect(container.querySelector('[data-toc="hotspots-stops"]')).toBeNull();
		await waitFor(() =>
			expect(cardTrigger(container, 'hotspots-lines')).toHaveAttribute('aria-expanded', 'false'),
		);

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const day = within(rail)
			.getAllByRole('radio')
			.find((radio) => radio.textContent?.trim() === 'Day');
		expect(day).toBeDefined();
		await fireEvent.click(day!);

		await waitFor(() => {
			expect(card(container, 'hotspots-stops')).not.toBeNull();
			expect(cardTrigger(container, 'hotspots-stops')).toHaveAttribute('aria-expanded', 'false');
		});
	});

	it('a TOC jump reveals only its closed Lines card before scrolling', async () => {
		const { container } = render(HotspotsBoard);
		const statesAtScroll: Array<{ linesOpen: string | null; topOpen: string | null }> = [];
		const scrollIntoView = vi.fn(() => {
			statesAtScroll.push({
				linesOpen: cardTrigger(container, 'hotspots-lines').getAttribute('aria-expanded'),
				topOpen: cardTrigger(container, 'hotspots-top').getAttribute('aria-expanded'),
			});
		});
		Element.prototype.scrollIntoView = scrollIntoView;
		await fireEvent.click(cardTrigger(container, 'hotspots-top'));
		await fireEvent.click(cardTrigger(container, 'hotspots-lines'));
		expect(cardTrigger(container, 'hotspots-top')).toHaveAttribute('aria-expanded', 'false');
		expect(cardTrigger(container, 'hotspots-lines')).toHaveAttribute('aria-expanded', 'false');

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await fireEvent.click(within(rail).getByRole('button', { name: 'Lines' }));
		await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
		expect(statesAtScroll).toEqual([{ linesOpen: 'true', topOpen: 'false' }]);
		expect(cardTrigger(container, 'hotspots-lines')).toHaveAttribute('aria-expanded', 'true');
		expect(cardTrigger(container, 'hotspots-top')).toHaveAttribute('aria-expanded', 'false');
	});

	it('renders below-floor evidence in semantic tables without fabricating readings', () => {
		const { container } = render(HotspotsBoard);
		const stopCard = card(container, 'hotspots-stops');
		const stopTray = stopCard.querySelector('[data-slot="hotspot-tray"]') as HTMLElement;
		const stopTables = stopTray.querySelectorAll('table[data-slot="hotspot-tray-table"]');
		expect(stopTables).toHaveLength(1);
		const stopTable = stopTables[0] as HTMLTableElement;
		expect(
			within(stopTable)
				.getAllByRole('columnheader')
				.map((cell) => cell.textContent?.trim()),
		).toEqual(['Item', 'Type / ID', 'Readings']);
		const detail = within(stopTable).getByRole('link', { name: /View detail for Quiet Ave/ });
		expect(detail).toHaveAttribute('href', '/stop/S2');
		const servedRow = detail.closest('tr') as HTMLTableRowElement;
		expect(servedRow).toHaveTextContent('Stop · S2');
		expect(servedRow).toHaveTextContent('12');
		expect(servedRow.querySelector('[data-slot="absent-value"]')).toBeNull();
		const reason = stopTray.querySelector('[data-slot="hotspot-tray-reason"]') as HTMLElement;
		expect(reason).toHaveTextContent(/not ranked/i);
		expect(stopTable).not.toContainElement(reason);

		const lineCard = card(container, 'hotspots-lines');
		const lineTable = lineCard.querySelector(
			'table[data-slot="hotspot-tray-table"]',
		) as HTMLTableElement;
		expect(lineTable).not.toBeNull();
		const nullTitle = within(lineTable).getByText('Sparse Route');
		const nullRow = nullTitle.closest('tr') as HTMLTableRowElement;
		expect(nullRow).toHaveTextContent('Line · R2');
		expect(nullRow.querySelectorAll('[data-slot="absent-value"]')).toHaveLength(1);
		expect(nullRow).not.toHaveTextContent(/\b0\b/);
		const zeroTitle = within(lineTable).getByText('Zero Route');
		const zeroRow = zeroTitle.closest('tr') as HTMLTableRowElement;
		expect(zeroRow).toHaveTextContent('Line · R3');
		expect(zeroRow.querySelector('.hotspot-tray-readings')).toHaveTextContent('0');
		expect(zeroRow.querySelector('[data-slot="absent-value"]')).toBeNull();

		const rankedTable = stopCard.querySelector('table.sr-only') as HTMLTableElement;
		expect(rankedTable).not.toBeNull();
		expect(within(rankedTable).getByRole('link', { name: 'Berri-UQAM' })).toHaveAttribute(
			'href',
			'/stop/S1',
		);
		expect(rankedTable).not.toBe(stopTable);
	});

	it('seeds the grain from ?grain=week and renders the matching conditional cards', () => {
		mockUrl = new URL('http://localhost/hotspots?grain=week');
		const { container } = render(HotspotsBoard);
		expect(
			within(card(container, 'hotspots-lines')).getByRole('link', { name: /Van Horne/ }),
		).toHaveAttribute('href', '/lines/161');
		expect(container.querySelector('[data-toc="hotspots-stops"]')).toBeNull();
	});

	it('clamps an invalid grain and mirrors grain changes while omitting the day default', async () => {
		mockUrl = new URL('http://localhost/hotspots?grain=garbage');
		const { container } = render(HotspotsBoard);
		await waitFor(() => expect(mockUrl.searchParams.get('grain')).toBeNull());
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const week = within(rail)
			.getAllByRole('radio')
			.find((el) => (el.textContent ?? '').toLowerCase().includes('week'));
		expect(week).toBeDefined();
		await fireEvent.click(week!);
		expect(mockUrl.searchParams.get('grain')).toBe('week');
	});

	it('seeds the shared worst-N cap from ?n and mirrors a change back to the URL', async () => {
		payload.current = largeSeed();
		mockUrl = new URL('http://localhost/hotspots?n=5');
		const { container } = render(HotspotsBoard);
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(6);
		expect(screen.getByText(/5\/6/)).toBeInTheDocument();
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const ten = within(rail)
			.getAllByRole('radio')
			.find((el) => el.textContent?.trim() === '10');
		expect(ten).toBeDefined();
		await fireEvent.click(ten!);
		expect(mockUrl.searchParams.get('n')).toBeNull();
	});

	it('uses the time-grid grain picker in row-major order and leaves Show default', () => {
		payload.current = largeSeed();
		const { container } = render(HotspotsBoard);
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const grain = within(rail).getByRole('radiogroup', { name: 'Granularity' });
		const show = within(rail).getByRole('radiogroup', { name: 'Show' });

		expect(grain).toHaveAttribute('data-variant', 'time-grid');
		expect(
			within(grain)
				.getAllByRole('radio')
				.map((radio) => radio.textContent?.trim()),
		).toEqual(['Day', 'Week', 'Month', 'Peak hours']);
		expect(show).toHaveAttribute('data-variant', 'default');
		expect(hotspotsCopy.fr.grain.day).toBe('Jour');
		expect(hotspotsCopy.fr.grain.week).toBe('Semaine');
		expect(hotspotsCopy.fr.grain.month).toBe('Mois');
		expect(hotspotsCopy.fr.grain.shiftCompact).toBe('Pointe');
		expect(hotspotsCopy.fr.grain.shift).toBe('Heures de pointe');
	});

	it('keeps the combined rail for a one-grain article while omitting the dead grain picker', () => {
		payload.current = routeOnlySeed();
		const { container } = render(HotspotsBoard);
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(rail.querySelector('[data-slot="grain-picker"]')).toBeNull();
		expect(within(rail).getByRole('button', { name: 'Lines' })).toBeInTheDocument();
		expect(
			within(card(container, 'hotspots-lines')).getByRole('link', { name: /Route 0/ }),
		).toHaveAttribute('href', '/lines/R0');
	});

	it('keeps the published-empty state outside collapsible cards', () => {
		payload.current = {
			generated_utc: '2026-06-25T00:00:00Z' as IsoUtc,
			hotspots: [],
			by_grain: [{ grain: 'day', entries: [], tray: [] }],
		} satisfies Hotspots as Hotspots;
		const { container } = render(HotspotsBoard);
		const empty = container.querySelector('[data-slot="hotspots-empty"]');
		expect(empty?.querySelector('[data-slot="absent-value"]')).toHaveAttribute(
			'data-variant',
			'block',
		);
		expect(container.querySelectorAll('[data-toc^="hotspots-"]')).toHaveLength(0);
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(0);
	});
});
