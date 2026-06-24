// HealthStatus.svelte.test.ts — the /status (data-health) screen, DOM gate.
//
// The surface is the full read-out of provenance.json: per-feed freshness, source
// lineage, declared data gaps, retention windows, and the full conformance verdict
// (verdict badge + the COMPLETE unknown-member list + the exact extra-row count).
//
// Honesty is the whole point of these assertions: a section whose slice of the
// manifest is absent/empty STANDS DOWN (renders nothing), never a fabricated or
// empty card. We render a rich fixture first (every section present), then a
// sparse one (sections absent) and assert each stands down.
//
// Renders in EN (getLocale() defaults to DEFAULT_LOCALE without a provider, same
// as the other feature-screen tests). The data ports are stubbed so this gate
// stays env-free + off-network; createResource hands back the fixture directly.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import type { IsoUtc, Provenance } from '$lib/v1/schemas';
import HealthStatus from './HealthStatus.svelte';
import { copy } from './health.copy';

const en = copy.en;

/** Brand an ISO string as the contract's IsoUtc (the runtime value is plain). */
const iso = (s: string) => s as unknown as IsoUtc;

// The mutable fixture the createResource mock reads BY REFERENCE, so a test can
// swap it for a sparse manifest before rendering. A rich provenance: two feeds
// with distinct run-statuses, two sources with lineage, a declared gap, both
// retention windows, and an out-of-norm conformance verdict naming five fields.
const rich: Provenance = {
	generated_utc: iso('2026-06-19T12:00:00Z'),
	freshness: [
		{ feed: 'realtime_vehicles', status: 'succeeded', age_s: 240 },
		{ feed: 'static_schedule', status: 'failed', age_s: 90000 },
	],
	sources: [
		{
			feed: 'realtime_vehicles',
			chain: 'r2:provider/rt/vehicles.pb',
			last_loaded_utc: iso('2026-06-19T11:56:00Z'),
		},
		{
			feed: 'static_schedule',
			chain: 'r2:provider/static/gtfs.zip',
			last_loaded_utc: iso('2026-06-18T11:00:00Z'),
		},
	],
	// The REAL feed token (terse), so the test pins the humanizer (→ "Metro: no
	// realtime feed"), not a pre-humanized sentence.
	gaps: ['metro_realtime'],
	retention: { detail_days: 14, aggregate_days: 365 },
	// A methodology dict mixing threaded keys (otp_definition → /metrics) with the
	// un-threaded ones (network_no_data / alert_breakdown → /status pipeline notes).
	methodology: {
		otp_definition: 'on-time = observed delay between -60s and +300s',
		network_no_data: 'network.json values are null (not 0) when their denominator is empty',
		alert_breakdown: 'distinct content-hashed alerts grouped by cause/effect/severity',
	},
	conformance: {
		status: 'out_of_norm',
		extra_row_count: 1234,
		unknown_members: [
			'wheelchair_boarding',
			'platform_code',
			'tts_stop_name',
			'level_id',
			'zone_id',
		],
	},
};

let fixture: Provenance = rich;

vi.mock('$lib/nav', async () => ({ layout: { isDesktop: true } }));

// The barrel mock must also export the freshness helpers HealthStatus imports
// (freshnessRelative powers the per-source "last loaded" age). Delegate to the
// real freshness module so the relative-age math stays honest in the DOM gate.
vi.mock('$lib/v1', async () => {
	const freshness = await import('$lib/v1/freshness');
	return { getProvenance: vi.fn(), freshnessRelative: freshness.freshnessRelative };
});

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: fixture,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

afterEach(() => {
	fixture = rich;
});

describe('HealthStatus — full manifest render', () => {
	it('renders the surface head + a NEUTRAL "Updated N ago" stamp, never the live "LIVE" chip', () => {
		render(HealthStatus);
		expect(screen.getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(screen.getByText(en.asOf)).toBeInTheDocument();
		// The shared FreshnessStamp renders here in its calm "updated" variant — a
		// neutral "Updated" label + a relative age, NOT the live-tier "LIVE" chip.
		const stamp = document.querySelector('[data-slot="health-asof"]') as HTMLElement;
		expect(stamp).not.toBeNull();
		const fresh = stamp.querySelector('[data-slot="freshness-stamp"]');
		expect(fresh).not.toBeNull();
		expect((fresh as HTMLElement).getAttribute('data-variant')).toBe('updated');
		// The "Updated" label is present; the relative age rides the <time> beside it.
		expect(within(fresh as HTMLElement).getByText('Updated')).toBeInTheDocument();
		expect((fresh as HTMLElement).querySelector('time')).not.toBeNull();
		// No live chip / no "LIVE" label leaks onto this daily document.
		expect(within(fresh as HTMLElement).queryByText('LIVE')).toBeNull();
	});

	it('AUTO-REFRESHES via the shared epoch: the provenance resource re-runs on a bump', async () => {
		// dataPulse bumps dataRefresh.epoch on a new publish; createResource surfaces
		// (incl. this provenance read) read `epoch` in their effect and re-fetch. We
		// assert /status opts into that by passing `{ freshness: true }` — the SAME
		// flag wires both the shared newest-data contribution AND the epoch re-run.
		const src = (await import('node:fs')).readFileSync(
			(await import('node:path')).resolve(
				process.cwd(),
				'src/lib/features/health/HealthStatus.svelte',
			),
			'utf-8',
		);
		expect(src).toMatch(
			/createResource\(\(\) => getProvenance\(\),\s*\{\s*freshness:\s*true\s*\}\)/,
		);
	});

	it('renders one per-feed freshness row with a humanized age + verdict', () => {
		render(HealthStatus);
		const list = screen.getByRole('list', { name: en.freshness.listLabel });
		// Both feeds appear by name.
		expect(within(list).getByText('realtime_vehicles')).toBeInTheDocument();
		expect(within(list).getByText('static_schedule')).toBeInTheDocument();
		// A succeeded run reads the "loaded" verdict; a failed run reads "load failed".
		expect(within(list).getAllByText(en.statusVerdict.ok).length).toBeGreaterThan(0);
		expect(within(list).getAllByText(en.statusVerdict.failed).length).toBeGreaterThan(0);
		// The age is humanized (a relative "ago" phrase), never the raw second count.
		expect(within(list).queryByText('240')).toBeNull();
		expect(within(list).getByText(/ago/)).toBeInTheDocument();
	});

	it('renders source lineage with the storage chain per feed', () => {
		render(HealthStatus);
		const list = screen.getByRole('list', { name: en.sources.listLabel });
		expect(within(list).getByText('r2:provider/rt/vehicles.pb')).toBeInTheDocument();
		expect(within(list).getByText('r2:provider/static/gtfs.zip')).toBeInTheDocument();
	});

	it('names declared data gaps in an honesty callout, humanizing the raw token', () => {
		render(HealthStatus);
		const list = screen.getByRole('list', { name: en.gaps.listLabel });
		// The raw feed token is humanized via the localized lookup, never shown raw.
		expect(within(list).getByText(en.gaps.tokens.metro_realtime)).toBeInTheDocument();
		expect(within(list).queryByText('metro_realtime')).toBeNull();
	});

	it('renders a Pipeline-notes section listing every un-threaded methodology string', () => {
		render(HealthStatus);
		const list = screen.getByRole('list', { name: en.pipelineNotes.listLabel });
		// The two un-threaded keys (no /metrics card) appear by human label + verbatim string.
		expect(within(list).getByText(en.pipelineNotes.labels.network_no_data)).toBeInTheDocument();
		expect(within(list).getByText(en.pipelineNotes.labels.alert_breakdown)).toBeInTheDocument();
		expect(within(list).getByText(rich.methodology!.network_no_data as string)).toBeInTheDocument();
		expect(within(list).getByText(rich.methodology!.alert_breakdown as string)).toBeInTheDocument();
		// A THREADED key (otp_definition → /metrics card) does NOT appear here.
		expect(within(list).queryByText(rich.methodology!.otp_definition as string)).toBeNull();
	});

	it('renders the retention stat pair (detail + aggregate days)', () => {
		render(HealthStatus);
		const detail = screen
			.getByText(en.retention.detailLabel)
			.closest('[data-slot="metric-display"]');
		const aggregate = screen
			.getByText(en.retention.aggregateLabel)
			.closest('[data-slot="metric-display"]');
		expect(detail).not.toBeNull();
		expect(aggregate).not.toBeNull();
		expect(
			within(detail as HTMLElement).getByText(`14${en.retention.daysUnit}`),
		).toBeInTheDocument();
		expect(
			within(aggregate as HTMLElement).getByText(`365${en.retention.daysUnit}`),
		).toBeInTheDocument();
	});

	it('renders the conformance verdict + the COMPLETE unknown-member list + exact extra-row count', () => {
		render(HealthStatus);
		// The conformance section overline is present.
		expect(screen.getByText(en.conformance.section)).toBeInTheDocument();
		// The full member list lives in a disclosure — content is force-mounted by
		// the shared CollapsibleSection (present even while collapsed). All five
		// members appear (not just the badge's 3-member preview).
		const list = screen.getByRole('list', { name: en.conformance.membersListLabel });
		for (const member of rich.conformance!.unknown_members!) {
			expect(within(list).getByText(member)).toBeInTheDocument();
		}
		// The EXACT extra-row count is shown (localized thousands separator).
		const extra = screen
			.getByText(en.conformance.extraRowsLabel)
			.closest('[data-slot="metric-display"]');
		expect(within(extra as HTMLElement).getByText('1,234')).toBeInTheDocument();
	});
});

describe('HealthStatus — honesty (sections stand down when absent)', () => {
	it('omits gaps / retention / conformance sections entirely when their data is absent', () => {
		fixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [{ feed: 'realtime_vehicles', status: 'succeeded', age_s: 60 }],
			sources: [],
			gaps: [],
			retention: {},
			conformance: null,
		};
		render(HealthStatus);

		// Freshness still renders (it has data); the empty/absent sections stand down.
		expect(screen.getByRole('list', { name: en.freshness.listLabel })).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: en.sources.listLabel })).toBeNull();
		expect(screen.queryByText(en.gaps.section)).toBeNull();
		expect(screen.queryByText(en.pipelineNotes.section)).toBeNull();
		expect(screen.queryByText(en.retention.section)).toBeNull();
		expect(screen.queryByText(en.conformance.section)).toBeNull();
	});

	it('stands the Pipeline-notes section down when every methodology key is already threaded to a metric', () => {
		fixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			// Only THREADED keys (each has a /metrics card) — nothing left for /status.
			methodology: { otp_definition: 'on-time band', cancellation: 'canceled / observed' },
			conformance: null,
		};
		render(HealthStatus);
		expect(screen.queryByText(en.pipelineNotes.section)).toBeNull();
		expect(screen.queryByRole('list', { name: en.pipelineNotes.listLabel })).toBeNull();
	});

	it('renders a conformance verdict but no disclosure when there are no unknown members', () => {
		fixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			conformance: { status: 'conformant', extra_row_count: 0, unknown_members: [] },
		};
		render(HealthStatus);
		// The section + badge render, but the unmodelled-fields disclosure stands down.
		expect(screen.getByText(en.conformance.section)).toBeInTheDocument();
		expect(screen.queryByText(en.conformance.detailsTitle)).toBeNull();
	});

	it('renders the styled honest-absence chip (never a fabricated 0) when extra_row_count is null', () => {
		fixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			// A named unknown member (so the disclosure mounts) but NO extra-row count
			// (absent/null in the payload — the honest path must show the styled absence
			// chip that says WHY the value is missing, not a fabricated 0).
			conformance: { status: 'out_of_norm', unknown_members: ['zone_id'] },
		};
		render(HealthStatus);
		const extra = screen
			.getByText(en.conformance.extraRowsLabel)
			.closest('[data-slot="metric-display"]') as HTMLElement;
		// The styled honest-absence chip renders (calm "unknown" tone), not plain text.
		const chip = extra.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('data-tone')).toBe('unknown');
		// No fabricated zero leaks in for the absent count.
		expect(within(extra).queryByText('0')).toBeNull();
	});
});
