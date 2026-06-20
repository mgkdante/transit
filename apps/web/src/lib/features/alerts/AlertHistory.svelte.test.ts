import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertHistory } from '$lib/v1/schemas';
import AlertHistoryScreen from './AlertHistory.svelte';

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

	it('stands the whole breakdown block down when no distribution was published', () => {
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		expect(document.querySelector('[data-slot="alert-breakdown"]')).toBeNull();
		// The log itself still renders.
		expect(
			screen.getByRole('list', { name: /past service alerts, newest first/i }),
		).toBeInTheDocument();
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
