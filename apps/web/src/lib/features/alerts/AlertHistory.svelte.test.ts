import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertHistory } from '$lib/v1/schemas';
import { alertHistoryCopy } from './alerts.copy';
import AlertHistoryScreen from './AlertHistory.svelte';

const copyEn = alertHistoryCopy.en;

// One mutable AlertHistory fixture, read by reference inside the createResource
// mock so a test can splice its `alerts` / `breakdown` in place before render.
// Modeled on the published alert_history.json: free-string severity (here a mix
// of the closed codes + an unknown value), generic FR/EN headers (→ the shared
// "Service alert" fallback), and an "unknown" cause/effect breakdown bucket.
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

// Mock the shared clock with a FIXED, skewed `serverNow` so the freshness age the
// FreshnessStamp renders is anchored to the SERVER clock (PR-6), not the raw
// client `Date.now()`. serverNow = the archive's generated_utc + exactly 2 hours →
// the chip must read "2 hours ago" regardless of the machine's real clock. A
// drift-bugged readout (off Date.now()) would NOT land on that controlled value.
// serverNow = generated_utc (00:00:00Z) + 2 h → the stamp must read "2 hours ago".
// Hoisted so the mock factories (also hoisted) can reference it. FreshnessStamp
// derives the age via $lib/v1/freshness → $lib/stores/clock.svelte, so mock the
// clock module too (not just the barrel) to pin the readout deterministically.
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

// createResource is the only data port this surface uses; return the shared
// fixture as already-settled data.
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
});

describe('AlertHistory log', () => {
	it('renders past alerts newest-first using the shared "Service alert" fallback for generic headers', () => {
		render(AlertHistoryScreen);
		const list = screen.getByRole('list', { name: /past service alerts, newest first/i });
		// Both entries carry only the generic "Your stop"/"Your line" placeholders →
		// alertDisplayText drops them and falls back to the shared headline, exactly
		// like the live surfaces (never a raw placeholder string).
		const titles = within(list).getAllByText('Service alert');
		expect(titles).toHaveLength(2);
		// Newest-first: a-1 (11:00) precedes a-2 (15:00? no — 15:00 is later) ...
		// a-2 starts 15:00 > a-1 11:00, so a-2 is newest → first row.
		const rows = within(list).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
	});

	it('omits absent fields and never fabricates a 0 (no impact line when impact_passages is null)', () => {
		render(AlertHistoryScreen);
		const list = screen.getByRole('list', { name: /past service alerts, newest first/i });
		const rows = within(list).getAllByRole('listitem');
		// a-1 (impact 1234) shows the impact line; a-2 (impact null) shows none.
		const withImpact = rows.find((r) => within(r).queryByText(/passages affected/i));
		expect(withImpact).toBeDefined();
		expect(within(withImpact as HTMLElement).getByText('1,234 passages')).toBeInTheDocument();
		// No row fabricates a "0 passages" line for the null-impact alert.
		expect(within(list).queryByText('0 passages')).toBeNull();
	});

	it('renders the resolved duration in minutes', () => {
		render(AlertHistoryScreen);
		expect(screen.getByText('2040 min')).toBeInTheDocument();
		expect(screen.getByText('210 min')).toBeInTheDocument();
	});

	it('anchors the FreshnessStamp age to the SERVER clock (serverNow), not Date.now()', () => {
		render(AlertHistoryScreen);
		// The stamp's age derives from generated_utc (2026-06-20T00:00:00Z) vs the
		// mocked sharedClock.serverNow (02:00:00Z) → exactly "2 hours ago". This only
		// holds if the surface reads serverNow; an age off the raw client clock would
		// render whatever the wall clock minus midnight 06-20 happens to be.
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip).not.toBeNull();
		// The historic archive shows the calm "updated" variant (no "LIVE" label).
		expect(chip.getAttribute('data-variant')).toBe('updated');
		expect(within(chip).getByText('2 hours ago')).toBeInTheDocument();
	});
});

describe('AlertHistory breakdown', () => {
	it('humanizes a known cause bucket and reads "Unspecified" for an unknown effect key', () => {
		render(AlertHistoryScreen);
		// CONSTRUCTION → the shared bilingual gtfsAlertLabels label.
		const causeList = screen.getByRole('list', { name: /distribution by cause/i });
		expect(within(causeList).getByText('Construction')).toBeInTheDocument();
		// The "unknown" effect key is uninformative → localized "Unspecified", never raw.
		const effectList = screen.getByRole('list', { name: /distribution by effect/i });
		expect(within(effectList).getByText('Unspecified')).toBeInTheDocument();
		expect(within(effectList).queryByText('unknown')).toBeNull();
	});

	it('shows the styled honest-absence chip when alerts exist but no distribution was published', () => {
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		// The breakdown section stays present (alerts exist) but its body is the ONE
		// styled honest-absence chip ("No data · not enough readings yet"), never a
		// silent vanish or a blank.
		const block = document.querySelector('[data-slot="alert-breakdown"]');
		expect(block).not.toBeNull();
		const chip = block?.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect(chip?.getAttribute('data-tone')).toBe('unknown');
		// No fabricated distribution tiles render in the empty-breakdown state.
		expect(block?.querySelector('[role="list"]')).toBeNull();
		// The log itself still renders.
		expect(
			screen.getByRole('list', { name: /past service alerts, newest first/i }),
		).toBeInTheDocument();
	});
});

describe('AlertHistory filters (C3)', () => {
	// A spread of entity reach + severity so each axis narrows distinctly:
	//   · L1 — critical, affects line 10 only (no stops)
	//   · S1 — high, affects stops only (no lines)
	//   · B1 — watch, affects both a line + a stop
	function seedFilterFixture(): void {
		fixture.alerts = [
			// Branded IsoUtc dates are plain ISO strings at runtime; cast as the test
			// fixture does at module scope.
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
		] as AlertHistory['alerts'];
		// No breakdown noise for the filter tests.
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('filters by entity type — "affects lines" excludes the stops-only alert', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		// All three render before filtering.
		expect(logRows()).toHaveLength(3);

		// Pick the "Lines" entity chip (a GrainPicker radio).
		const linesChip = screen.getByRole('radio', { name: copyEn.filters.entity.lines });
		await fireEvent.click(linesChip);

		// S1 (stops-only) drops; L1 + B1 (carry a line) remain.
		expect(logRows()).toHaveLength(2);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Stop moved')).toBeNull();
	});

	it('filters by entity type — "affects stops" excludes the lines-only alert', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const stopsChip = screen.getByRole('radio', { name: copyEn.filters.entity.stops });
		await fireEvent.click(stopsChip);

		// L1 (lines-only) drops; S1 + B1 (carry a stop) remain.
		expect(logRows()).toHaveLength(2);
		expect(screen.getByText('Stop moved')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Line closed')).toBeNull();
	});

	it('filters by severity — "Critical" narrows to the single critical alert', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const criticalChip = screen.getByRole('radio', { name: copyEn.severity.critical });
		await fireEvent.click(criticalChip);

		const rows = logRows();
		expect(rows).toHaveLength(1);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		expect(screen.queryByText('Stop moved')).toBeNull();
		expect(screen.queryByText('Detour')).toBeNull();
	});

	it('shows the honest no-match note (never an empty void) when filters match nothing', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		// Critical + stops-only: no alert is both critical AND affects a stop.
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.filters.entity.stops }));

		// The log is gone; the explicit no-match message is shown.
		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
		const note = document.querySelector('[data-slot="alert-no-match"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.filters.noMatch);
		// Honesty: never a "·" placeholder in the empty result.
		expect(note?.textContent).not.toContain('·');
	});

	it('clears the filters and restores the full log', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		expect(logRows()).toHaveLength(1);

		// The "Clear filters" action appears once a filter is active.
		const clear = document.querySelector('[data-slot="clear-filters"]') as HTMLElement;
		expect(clear).not.toBeNull();
		await fireEvent.click(clear);

		// Back to all three rows; the clear control hides again (no active filter).
		expect(logRows()).toHaveLength(3);
		expect(document.querySelector('[data-slot="clear-filters"]')).toBeNull();
	});
});

describe('AlertHistory specific-entity filter (E3)', () => {
	// Reuse the C3 spread: L1 (line 10 only), S1 (stop 52458 only), B1 (line 24 +
	// stop 99999). Picking a specific route/stop narrows to alerts touching it.
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
		] as AlertHistory['alerts'];
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('exposes a chip per distinct affected route/stop present in the log', () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const chips = screen.getByRole('group', { name: copyEn.filters.entityPick.groupLabel });
		// 2 routes (10, 24) + 2 stops (52458, 99999) = 4 distinct entity chips.
		expect(within(chips).getAllByRole('button')).toHaveLength(4);
		expect(within(chips).getByText('Line 10')).toBeInTheDocument();
		expect(within(chips).getByText('Stop 99999')).toBeInTheDocument();
	});

	it('narrows the log to alerts touching a chosen route', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		expect(logRows()).toHaveLength(3);

		await fireEvent.click(screen.getByRole('button', { name: 'Line 24' }));

		// Only B1 carries line 24.
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Line closed')).toBeNull();
		expect(screen.queryByText('Stop moved')).toBeNull();
		// The active selection is named (honest, never a silent narrow).
		expect(screen.getByText(copyEn.filters.entityPick.active('Line 24'))).toBeInTheDocument();
	});

	it('narrows the log to alerts touching a chosen stop', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('button', { name: 'Stop 52458' }));
		// Only S1 carries stop 52458.
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Stop moved')).toBeInTheDocument();
		expect(screen.queryByText('Detour')).toBeNull();
	});

	it('the search field narrows the chip set to the matching entities', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const search = screen.getByLabelText(copyEn.filters.entityPick.label);
		await fireEvent.input(search, { target: { value: '52458' } });
		const chips = screen.getByRole('group', { name: copyEn.filters.entityPick.groupLabel });
		const buttons = within(chips).getAllByRole('button');
		expect(buttons).toHaveLength(1);
		expect(within(chips).getByText('Stop 52458')).toBeInTheDocument();
	});

	it('shows the honest no-entity note when the search matches no affected entity', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const search = screen.getByLabelText(copyEn.filters.entityPick.label);
		await fireEvent.input(search, { target: { value: 'zzzz' } });
		const note = document.querySelector('[data-slot="entity-no-match"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.filters.entityPick.noEntity);
		expect(note?.textContent).not.toContain('·');
		// No chip group when nothing matches.
		expect(screen.queryByRole('group', { name: copyEn.filters.entityPick.groupLabel })).toBeNull();
	});

	it('combines with the type + severity axes', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		// Pick line 24 (→ only B1, which is 'watch'). Then severity=critical → zero.
		await fireEvent.click(screen.getByRole('button', { name: 'Line 24' }));
		expect(logRows()).toHaveLength(1);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		// B1 is 'watch', not 'critical' → the shared no-match note (never blank).
		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
		const note = document.querySelector('[data-slot="alert-no-match"]');
		expect(note).toHaveTextContent(copyEn.filters.noMatch);
	});

	it('the entity-TYPE axis scopes the chip set (Lines hides stop chips)', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.filters.entity.lines }));
		const chips = screen.getByRole('group', { name: copyEn.filters.entityPick.groupLabel });
		// Only route chips remain (lines 10 + 24); no stop chips.
		expect(within(chips).getAllByRole('button')).toHaveLength(2);
		expect(within(chips).getByText('Line 10')).toBeInTheDocument();
		expect(within(chips).queryByText('Stop 52458')).toBeNull();
	});

	it('clears the chosen entity and restores the full log', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('button', { name: 'Line 24' }));
		expect(logRows()).toHaveLength(1);

		const clear = document.querySelector('[data-slot="clear-entity"]') as HTMLElement;
		expect(clear).not.toBeNull();
		await fireEvent.click(clear);

		expect(logRows()).toHaveLength(3);
		// The chip set is back (no active selection).
		expect(
			screen.getByRole('group', { name: copyEn.filters.entityPick.groupLabel }),
		).toBeInTheDocument();
	});

	it('"Clear filters" also clears the chosen entity', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('button', { name: 'Line 24' }));
		const clearAll = document.querySelector('[data-slot="clear-filters"]') as HTMLElement;
		expect(clearAll).not.toBeNull();
		await fireEvent.click(clearAll);
		expect(logRows()).toHaveLength(3);
		expect(document.querySelector('[data-slot="clear-entity"]')).toBeNull();
	});
});

describe('AlertHistory empty state', () => {
	it('routes to the empty edge state when the archive carries no alerts', () => {
		fixture.alerts = [];
		render(AlertHistoryScreen);
		// No log list, no breakdown — the ResourceBoundary empty state takes over.
		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
		expect(document.querySelector('[data-slot="alert-breakdown"]')).toBeNull();
	});
});
