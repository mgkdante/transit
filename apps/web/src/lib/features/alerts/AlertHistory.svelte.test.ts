import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertHistory } from '$lib/v1/schemas';
import { alertHistoryCopy } from './alerts.copy';
import AlertHistoryScreen from './AlertHistory.svelte';

const copyEn = alertHistoryCopy.en;

// One mutable AlertHistory fixture, read by reference inside the createResource mock
// so a test can splice its `alerts` / `breakdown` / window envelope in place before
// render. Modeled on the published alert_history.json (free-string severity, generic
// FR/EN headers → the shared "Service alert" fallback, an "unknown" breakdown bucket).
const { fixture } = vi.hoisted(() => ({
	fixture: {
		generated_utc: '2026-06-20T00:00:00Z',
		alerts: [
			{
				id: 'a-1',
				severity: 'watch',
				header_text: 'Votre arrêt',
				header_text_en: 'Your stop',
				routes: ['24'],
				stops: ['52458', '52487'],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-21T21:00:00Z',
				duration_min: 2040,
				impact_passages: 1234,
			},
			{
				id: 'a-2',
				severity: 'watch',
				header_text: 'Votre ligne',
				header_text_en: 'Your line',
				routes: ['99'],
				stops: [],
				start_utc: '2026-06-20T15:00:00Z',
				end_utc: '2026-06-20T18:30:00Z',
				duration_min: 210,
				impact_passages: null,
			},
		],
		breakdown: {
			by_cause: [{ key: 'CONSTRUCTION', count: 7, median_duration_min: 300 }],
			by_effect: [{ key: 'unknown', count: 9, median_duration_min: 120 }],
			by_severity: [{ key: 'watch', count: 9, median_duration_min: 240 }],
		},
	} as AlertHistory,
}));

vi.mock('$lib/v1', () => ({
	getAlertHistory: vi.fn(),
}));

// The SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the codec
// seed AND the round-trip mirror are testable. Hoisted so the mock factories can see it.
const nav = vi.hoisted(() => ({ url: new URL('http://localhost/alerts') }));
const replaceState = vi.hoisted(() =>
	vi.fn((u: string | URL) => {
		nav.url = new URL(u, 'http://localhost');
	}),
);
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return nav.url;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ replaceState }));

function setUrl(path: string): void {
	nav.url = new URL(path, 'http://localhost');
}

// Mock the shared clock with a FIXED, skewed `serverNow` so the FreshnessStamp age is
// anchored to the SERVER clock (serverNow = generated_utc + 2 h → "2 hours ago").
const clockStub = vi.hoisted(() => ({
	get now() {
		return Date.parse('2026-06-20T02:00:00Z');
	},
	get serverNow() {
		return Date.parse('2026-06-20T02:00:00Z');
	},
	subscribe: () => () => {},
}));
vi.mock('$lib/stores/clock.svelte', () => ({ sharedClock: clockStub }));
vi.mock('$lib/stores', () => ({ sharedClock: clockStub }));

// createResource returns the shared fixture as already-settled data.
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: fixture,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

const ORIGINAL_ALERTS = JSON.parse(JSON.stringify(fixture.alerts));
const ORIGINAL_BREAKDOWN = JSON.parse(JSON.stringify(fixture.breakdown));
afterEach(() => {
	fixture.alerts = JSON.parse(JSON.stringify(ORIGINAL_ALERTS));
	fixture.breakdown = JSON.parse(JSON.stringify(ORIGINAL_BREAKDOWN));
	delete (fixture as AlertHistory).window_start;
	delete (fixture as AlertHistory).window_end;
	delete (fixture as AlertHistory).total_in_window;
	delete (fixture as AlertHistory).truncated;
	setUrl('http://localhost/alerts');
	replaceState.mockClear();
});

describe('AlertHistory log', () => {
	it('renders past alerts newest-first using the shared "Service alert" fallback for generic headers', () => {
		render(AlertHistoryScreen);
		const list = screen.getByRole('list', { name: /past service alerts, newest first/i });
		const titles = within(list).getAllByText('Service alert');
		expect(titles).toHaveLength(2);
		const rows = within(list).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
	});

	it('omits absent fields and never fabricates a 0 (no impact line when impact_passages is null)', () => {
		render(AlertHistoryScreen);
		const list = screen.getByRole('list', { name: /past service alerts, newest first/i });
		const rows = within(list).getAllByRole('listitem');
		const withImpact = rows.find((r) => within(r).queryByText(/passages affected/i));
		expect(withImpact).toBeDefined();
		expect(within(withImpact as HTMLElement).getByText('1,234 passages')).toBeInTheDocument();
		expect(within(list).queryByText('0 passages')).toBeNull();
	});

	it('renders the resolved duration in minutes', () => {
		render(AlertHistoryScreen);
		expect(screen.getByText('2040 min')).toBeInTheDocument();
		expect(screen.getByText('210 min')).toBeInTheDocument();
	});

	it('anchors the FreshnessStamp age to the SERVER clock (serverNow), not Date.now()', () => {
		render(AlertHistoryScreen);
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(chip.getAttribute('data-variant')).toBe('updated');
		expect(within(chip).getByText('2 hours ago')).toBeInTheDocument();
	});

	it('lists ALL active windows when an alert carries more than one (D1)', () => {
		fixture.alerts = [
			{
				id: 'multi',
				severity: 'high',
				header_text_en: 'Weekend closure',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-06T09:00:00Z',
				end_utc: '2026-06-07T21:00:00Z',
				active_periods: [
					{ start_utc: '2026-06-06T09:00:00Z', end_utc: '2026-06-07T21:00:00Z' },
					{ start_utc: '2026-06-13T09:00:00Z', end_utc: '2026-06-14T21:00:00Z' },
				],
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		const windows = document.querySelector('[data-slot="alert-windows"]');
		expect(windows).not.toBeNull();
		expect(windows).toHaveTextContent(copyEn.meta.windowsCount(2));
	});

	it('renders a present url as a SAFE external link with its host', () => {
		fixture.alerts = [
			{
				id: 'linked',
				severity: 'watch',
				header_text_en: 'Detour',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-20T12:00:00Z',
				url: 'https://stm.info/en/info/service-updates/x',
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		const link = document.querySelector('[data-slot="alert-link"]') as HTMLAnchorElement;
		expect(link).not.toBeNull();
		expect(link.getAttribute('href')).toBe('https://stm.info/en/info/service-updates/x');
		expect(link.getAttribute('rel')).toContain('noopener');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link).toHaveTextContent('stm.info');
	});

	it('shows the honest cap note when the served window was truncated', () => {
		(fixture as AlertHistory).truncated = true;
		(fixture as AlertHistory).total_in_window = 512;
		render(AlertHistoryScreen);
		const note = document.querySelector('[data-slot="alert-truncated"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.truncatedNote(2, 512));
	});

	it('cap note keeps the SERVED count under an active client filter (never the filtered subset)', () => {
		// The server cap clipped the SERVED payload newest-first; a client-side
		// severity filter narrows the visible list but must not shrink the "shown"
		// number, or the note misreads as "the N most recent" (S15 review F1).
		(fixture as AlertHistory).truncated = true;
		(fixture as AlertHistory).total_in_window = 512;
		setUrl('http://localhost/alerts?severity=critical');
		render(AlertHistoryScreen);
		const note = document.querySelector('[data-slot="alert-truncated"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.truncatedNote(2, 512));
	});
});

describe('AlertHistory headline', () => {
	it('shows the in-window alert count + median duration sublabel', () => {
		render(AlertHistoryScreen);
		const card = document.querySelector('[data-slot="alert-headline"]');
		expect(card).not.toBeNull();
		// Two alerts in window; median of [2040, 210] = 1125.
		expect(card).toHaveTextContent('2');
		expect(card).toHaveTextContent(copyEn.headline.median(1125));
	});
});

describe('AlertHistory breakdown', () => {
	it('humanizes a known cause bucket and reads "Unspecified" for an unknown effect key', () => {
		render(AlertHistoryScreen);
		const causeList = screen.getByRole('list', { name: /distribution by cause/i });
		expect(within(causeList).getByText('Construction')).toBeInTheDocument();
		const effectList = screen.getByRole('list', { name: /distribution by effect/i });
		expect(within(effectList).getByText('Unspecified')).toBeInTheDocument();
		expect(within(effectList).queryByText('unknown')).toBeNull();
	});

	it('shows the styled honest-absence chip when alerts exist but no distribution was published', () => {
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		const block = document.querySelector('[data-slot="alert-breakdown"]');
		expect(block).not.toBeNull();
		const chip = block?.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect(chip?.getAttribute('data-tone')).toBe('unknown');
		expect(block?.querySelector('[role="list"]')).toBeNull();
		expect(
			screen.getByRole('list', { name: /past service alerts, newest first/i }),
		).toBeInTheDocument();
	});
});

describe('AlertHistory filters — entity-type + severity radiogroups (codec-backed)', () => {
	function seedFilterFixture(): void {
		fixture.alerts = [
			{
				id: 'L1',
				severity: 'critical',
				header_text: 'Ligne fermée',
				header_text_en: 'Line closed',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-20T09:00:00Z',
				end_utc: '2026-06-20T10:00:00Z',
				duration_min: 60,
				impact_passages: 100,
			},
			{
				id: 'S1',
				severity: 'high',
				header_text: 'Arrêt déplacé',
				header_text_en: 'Stop moved',
				routes: [],
				stops: ['52458'],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-20T12:00:00Z',
				duration_min: 60,
				impact_passages: 50,
			},
			{
				id: 'B1',
				severity: 'watch',
				header_text: 'Détour',
				header_text_en: 'Detour',
				routes: ['24'],
				stops: ['99999'],
				start_utc: '2026-06-20T13:00:00Z',
				end_utc: '2026-06-20T14:00:00Z',
				duration_min: 60,
				impact_passages: 25,
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('filters by entity type — "affects lines" excludes the stops-only alert AND mirrors ?affects', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		expect(logRows()).toHaveLength(3);

		const linesChip = screen.getByRole('radio', { name: copyEn.filters.entity.lines });
		await fireEvent.click(linesChip);

		expect(logRows()).toHaveLength(2);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Stop moved')).toBeNull();
		// The pick mirrored to the codec ?affects key (round-trip persistence).
		expect(nav.url.searchParams.get('affects')).toBe('lines');
	});

	it('filters by entity type — "affects stops" excludes the lines-only alert', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const stopsChip = screen.getByRole('radio', { name: copyEn.filters.entity.stops });
		await fireEvent.click(stopsChip);

		expect(logRows()).toHaveLength(2);
		expect(screen.getByText('Stop moved')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Line closed')).toBeNull();
	});

	it('filters by severity — "Critical" narrows to the single critical alert AND mirrors ?severity', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const criticalChip = screen.getByRole('radio', { name: copyEn.severity.critical });
		await fireEvent.click(criticalChip);

		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		expect(nav.url.searchParams.get('severity')).toBe('critical');
	});

	it('shows the honest no-match note (never an empty void) when filters match nothing', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.filters.entity.stops }));

		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
		const note = document.querySelector('[data-slot="alert-no-match"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.filters.noMatch);
		expect(note?.textContent).not.toContain('·');
	});

	it('clears the filters and restores the full log', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		expect(logRows()).toHaveLength(1);

		const clear = document.querySelector('[data-slot="clear-filters"]') as HTMLElement;
		expect(clear).not.toBeNull();
		await fireEvent.click(clear);

		expect(logRows()).toHaveLength(3);
		expect(document.querySelector('[data-slot="clear-filters"]')).toBeNull();
	});
});

describe('AlertHistory specific-entity pickers (Line / Stop) — codec-seeded', () => {
	function seedFilterFixture(): void {
		fixture.alerts = [
			{
				id: 'L1',
				severity: 'critical',
				header_text_en: 'Line closed',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-20T09:00:00Z',
				end_utc: '2026-06-20T10:00:00Z',
			},
			{
				id: 'S1',
				severity: 'high',
				header_text_en: 'Stop moved',
				routes: [],
				stops: ['52458'],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-20T12:00:00Z',
			},
			{
				id: 'B1',
				severity: 'watch',
				header_text_en: 'Detour',
				routes: ['24'],
				stops: ['99999'],
				start_utc: '2026-06-20T13:00:00Z',
				end_utc: '2026-06-20T14:00:00Z',
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('exposes a labeled Line picker and a Stop picker (the type carried once, no per-row prefix)', () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		// Two combobox pickers, each with its own labeled input; the group label names the
		// type once (the LineCombobox input carries it as aria-label — no per-row prefix).
		const linePick = document.querySelector('[data-slot="line-pick"]');
		const stopPick = document.querySelector('[data-slot="stop-pick"]');
		expect(linePick).not.toBeNull();
		expect(stopPick).not.toBeNull();
		expect(
			within(linePick as HTMLElement).getByRole('combobox', { name: copyEn.filters.line.label }),
		).toBeInTheDocument();
		expect(
			within(stopPick as HTMLElement).getByRole('combobox', { name: copyEn.filters.stop.label }),
		).toBeInTheDocument();
		// The old bespoke chip set / SearchInput is GONE.
		expect(document.querySelector('[data-slot="entity-chips"]')).toBeNull();
	});

	it('seeds the Line pick from ?route= and narrows the log to that line', () => {
		seedFilterFixture();
		setUrl('http://localhost/alerts?route=24');
		render(AlertHistoryScreen);
		// Only B1 carries line 24.
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Line closed')).toBeNull();
		expect(screen.queryByText('Stop moved')).toBeNull();
	});

	it('seeds the Stop pick from ?stop= and narrows the log to that stop (route 24 vs stop never collide)', () => {
		seedFilterFixture();
		setUrl('http://localhost/alerts?stop=52458');
		render(AlertHistoryScreen);
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Stop moved')).toBeInTheDocument();
		expect(screen.queryByText('Detour')).toBeNull();
	});

	it('seeds affects + severity from the URL (promoted axes round-trip)', () => {
		seedFilterFixture();
		setUrl('http://localhost/alerts?affects=lines&severity=critical');
		render(AlertHistoryScreen);
		// affects=lines (L1 + B1) ∩ severity=critical (L1) → just L1.
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		// The seeded axes are reflected on the radiogroups.
		expect(
			(
				screen.getByRole('radio', { name: copyEn.filters.entity.lines }) as HTMLElement
			).getAttribute('aria-checked'),
		).toBe('true');
	});
});

describe('AlertHistory date window (?from/?to)', () => {
	function seedWindowFixture(): void {
		fixture.alerts = [
			{
				id: 'early',
				severity: 'watch',
				header_text_en: 'Early alert',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-01T09:00:00Z',
				end_utc: '2026-06-01T10:00:00Z',
			},
			{
				id: 'late',
				severity: 'watch',
				header_text_en: 'Late alert',
				routes: ['20'],
				stops: [],
				start_utc: '2026-06-20T09:00:00Z',
				end_utc: '2026-06-20T10:00:00Z',
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('seeds ?from/?to and clips the log to alerts intersecting the span', () => {
		seedWindowFixture();
		// Payload carries the served span so availableDates covers the seed.
		(fixture as AlertHistory).window_start = '2026-06-01';
		(fixture as AlertHistory).window_end = '2026-06-30';
		setUrl('http://localhost/alerts?from=2026-06-15&to=2026-06-25');
		render(AlertHistoryScreen);
		// Only the late alert intersects [06-15, 06-25].
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Late alert')).toBeInTheDocument();
		expect(screen.queryByText('Early alert')).toBeNull();
	});

	it('renders the date-range picker over the served span (both selects present)', () => {
		seedWindowFixture();
		(fixture as AlertHistory).window_start = '2026-06-01';
		(fixture as AlertHistory).window_end = '2026-06-30';
		render(AlertHistoryScreen);
		const picker = document.querySelector('[data-slot="date-range"]');
		expect(picker).not.toBeNull();
		expect(within(picker as HTMLElement).getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
	});

	it('hides the picker with honest absence when NOTHING is datable (no window fields, undatable entries)', () => {
		fixture.alerts = [
			{ id: 'u', severity: 'watch', header_text_en: 'Undatable', routes: ['10'], stops: [] },
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		const pick = document.querySelector('[data-slot="window-pick"]');
		expect(pick).not.toBeNull();
		// The DateRangePicker renders its honest-absence AbsentValue (no selects).
		expect(pick?.querySelector('[data-slot="date-range"]')).toBeNull();
		expect(pick?.querySelector('[data-slot="absent-value"]')).not.toBeNull();
	});
});

describe('AlertHistory filter rail (P5.4e SurfaceRail — glass left rail + mobile pill→sheet)', () => {
	it('mounts the filter widgets inside the SurfaceRail (desktop glass panel present)', () => {
		render(AlertHistoryScreen);
		// The desktop glass rail <aside> carries the filter body (single source).
		const rail = document.querySelector('[data-slot="surface-rail"]');
		expect(rail).not.toBeNull();
		expect(rail?.querySelector('[data-slot="alert-filters"]')).not.toBeNull();
		// The filter axes render once (rail only; the mobile sheet is closed).
		expect(document.querySelectorAll('[data-slot="line-pick"]')).toHaveLength(1);
		// The old ControlsRail wrapper class is gone (bounded chrome swap).
		expect(document.querySelector('.alert-history-filters')).toBeNull();
	});

	it('exposes ONE mobile filter pill that opens ONE sheet holding the SAME filters', async () => {
		render(AlertHistoryScreen);
		const mobile = document.querySelector('[data-slot="surface-rail-mobile"]');
		expect(mobile).not.toBeNull();
		const pill = mobile?.querySelector('button') as HTMLButtonElement;
		expect(pill).not.toBeNull();
		expect(pill.getAttribute('aria-expanded')).toBe('false');
		// No sheet until the pill is tapped.
		expect(document.querySelector('[role="dialog"]')).toBeNull();

		await fireEvent.click(pill);
		expect(pill.getAttribute('aria-expanded')).toBe('true');
		const sheet = document.querySelector('[role="dialog"]') as HTMLElement;
		expect(sheet).not.toBeNull();
		// The sheet renders the SAME filter body (the entity radiogroup lives inside it).
		expect(sheet.querySelector('[data-slot="alert-filters"]')).not.toBeNull();
		expect(
			within(sheet).getByRole('radio', { name: copyEn.filters.entity.lines }),
		).toBeInTheDocument();
	});
});

describe('AlertHistory empty state', () => {
	it('routes to the empty edge state when the archive carries no alerts', () => {
		fixture.alerts = [];
		render(AlertHistoryScreen);
		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
		expect(document.querySelector('[data-slot="alert-breakdown"]')).toBeNull();
	});
});
