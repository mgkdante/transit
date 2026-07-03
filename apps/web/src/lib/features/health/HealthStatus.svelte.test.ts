// HealthStatus.svelte.test.ts — the /status (data-health) screen, DOM gate (S11).
//
// The surface is the read-out of TWO honesty documents: provenance.json (per-feed
// freshness, source lineage, declared gaps, retention windows, the full conformance
// verdict) AND data_health.json (the S11 per-publish-lane freshness + last-gate
// outcome + the build-accountability envelope).
//
// Honesty is the whole point of these assertions: a section whose slice is
// absent/empty STANDS DOWN (renders nothing), never a fabricated or empty card. We
// render a rich fixture (every section present), then sparse ones (sections absent)
// and assert each stands down — including the S11 lanes section standing down when
// data_health is absent (a legacy publish).
//
// Renders in EN (getLocale() defaults to DEFAULT_LOCALE without a provider). The
// data ports are stubbed so this gate stays env-free + off-network; createResource
// hands back the per-repository fixture directly (keyed by the fetcher).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import type { DataHealth, IsoUtc, Provenance } from '$lib/v1/schemas';
import HealthStatus from './HealthStatus.svelte';
import { copy } from './health.copy';

const en = copy.en;

/** Brand an ISO string as the contract's IsoUtc (the runtime value is plain). */
const iso = (s: string) => s as unknown as IsoUtc;

// A rich provenance: two feeds with distinct run-statuses, two sources with
// lineage, a declared gap, both retention windows, an out-of-norm conformance
// verdict naming five fields, and the envelope fields (so the accountability
// section renders off provenance when data_health lacks them).
const richProvenance: Provenance = {
	generated_utc: iso('2026-06-19T12:00:00Z'),
	schema_version: 3,
	methodology_version: 'historic-2',
	publish_generation_id: 'gen-prov-xyz',
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
	gaps: ['metro_realtime'],
	// A methodology dict mixing threaded keys (otp_definition → /metrics) with the
	// un-threaded ones (network_no_data / alert_breakdown → pipeline notes) AND two
	// S10-noted keys with no explicit label (wilson_z labelled, an unknown key not).
	methodology: {
		otp_definition: 'on-time = observed delay between -60s and +300s',
		network_no_data: 'network.json values are null (not 0) when their denominator is empty',
		alert_breakdown: 'distinct content-hashed alerts grouped by cause/effect/severity',
		wilson_z: 'z = 1.96 for a 95% Wilson interval',
		some_new_key: 'a pipeline note the copy has no label for yet',
	},
	retention: { detail_days: 14, aggregate_days: 365 },
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

// A rich data_health: three lanes (live gated pass, static gated warn, rollup with
// an honest-NULL gate — predates 0078), plus its OWN envelope (live-lane stamp).
const richDataHealth: DataHealth = {
	generated_utc: iso('2026-06-19T12:00:00Z'),
	schema_version: 1,
	methodology_version: 'live-1',
	publish_generation_id: 'gen-live-abc',
	lanes: [
		{
			lane: 'live',
			last_publish_utc: iso('2026-06-19T11:59:03Z'),
			age_s: 57,
			files_written: 5,
			files_skipped: 0,
			files_total: 5,
			gate: {
				checks_run: 42,
				errors: 0,
				warnings: 0,
				verdict: 'pass',
				generated_utc: iso('2026-06-19T11:59:03Z'),
			},
		},
		{
			lane: 'static',
			last_publish_utc: iso('2026-06-19T06:00:00Z'),
			age_s: 21600,
			files_written: 118,
			files_skipped: 2,
			files_total: 120,
			gate: {
				checks_run: 30,
				errors: 0,
				warnings: 3,
				verdict: 'warn',
				generated_utc: iso('2026-06-19T06:00:00Z'),
			},
		},
		{
			// A lane that predates 0078: honest-NULL gate (verdict UNKNOWN, never a
			// fabricated pass).
			lane: 'rollup',
			last_publish_utc: iso('2026-06-19T07:00:00Z'),
			age_s: 18000,
			files_written: null,
			files_skipped: null,
			files_total: null,
			gate: null,
		},
	],
	feeds: [{ feed: 'realtime_vehicles', status: 'succeeded', age_s: 40 }],
};

// The mutable fixtures the createResource mock reads BY REFERENCE (keyed by which
// repository fetcher the resource was created with), so a test can swap either for
// a sparse variant before rendering.
let provenanceFixture: Provenance = richProvenance;

/** A provenance payload predating the PayloadEnvelope fields (legacy publish). */
function stripEnvelope(prov: Provenance): Provenance {
	const { schema_version, methodology_version, publish_generation_id, ...rest } = prov;
	void schema_version;
	void methodology_version;
	void publish_generation_id;
	return rest as Provenance;
}
let dataHealthFixture: DataHealth | null = richDataHealth;

vi.mock('$lib/nav', async () => ({ layout: { isDesktop: true } }));

// The barrel mock exports the two fetchers (distinct spy identities so the resource
// mock can tell them apart) + the freshness helper HealthStatus imports. The spies
// live in a vi.hoisted block so both the (hoisted) vi.mock factories AND the test
// bodies can reference them. freshnessRelative delegates to the real module so
// relative-age math stays honest.
const { getProvenance, getDataHealth } = vi.hoisted(() => ({
	getProvenance: vi.fn(),
	getDataHealth: vi.fn(),
}));
vi.mock('$lib/v1', async () => {
	const freshness = await import('$lib/v1/freshness');
	return {
		getProvenance,
		getDataHealth,
		freshnessRelative: freshness.freshnessRelative,
	};
});

// createResource is mocked to return the fixture for the matching fetcher. The
// component owns the arrow fetchers, so we can't compare identity — instead we
// INVOKE the fetcher (harmless: the stubbed getters return undefined) and route by
// which spy fired. getDataHealth firing → the data-health resource; else provenance.
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (fetcher: () => unknown) => {
		getProvenance.mockClear();
		getDataHealth.mockClear();
		try {
			fetcher();
		} catch {
			// fetchers are stubbed to return undefined; ignore.
		}
		const isDataHealth = getDataHealth.mock.calls.length > 0;
		return {
			data: isDataHealth ? dataHealthFixture : provenanceFixture,
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

afterEach(() => {
	provenanceFixture = richProvenance;
	dataHealthFixture = richDataHealth;
});

describe('HealthStatus — full manifest render', () => {
	it('renders the surface head + a NEUTRAL "Updated N ago" stamp, never the live "LIVE" chip', () => {
		render(HealthStatus);
		expect(screen.getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(screen.getByText(en.asOf)).toBeInTheDocument();
		const stamp = document.querySelector('[data-slot="health-asof"]') as HTMLElement;
		expect(stamp).not.toBeNull();
		const fresh = stamp.querySelector('[data-slot="freshness-stamp"]');
		expect(fresh).not.toBeNull();
		expect((fresh as HTMLElement).getAttribute('data-variant')).toBe('updated');
		expect(within(fresh as HTMLElement).getByText('Updated')).toBeInTheDocument();
		expect((fresh as HTMLElement).querySelector('time')).not.toBeNull();
		expect(within(fresh as HTMLElement).queryByText('LIVE')).toBeNull();
	});

	it('AUTO-REFRESHES both resources via the shared epoch (freshness: true on each)', async () => {
		// dataPulse bumps dataRefresh.epoch on a new publish; createResource surfaces
		// read `epoch` in their effect and re-fetch. We assert /status opts BOTH the
		// provenance AND the data-health reads into that via `{ freshness: true }`.
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
		expect(src).toMatch(
			/createResource\(\(\) => getDataHealth\(\),\s*\{\s*freshness:\s*true\s*\}\)/,
		);
	});

	it('renders one per-feed freshness row with a humanized age + verdict', () => {
		render(HealthStatus);
		const list = screen.getByRole('list', { name: en.freshness.listLabel });
		expect(within(list).getByText('realtime_vehicles')).toBeInTheDocument();
		expect(within(list).getByText('static_schedule')).toBeInTheDocument();
		expect(within(list).getAllByText(en.statusVerdict.ok).length).toBeGreaterThan(0);
		expect(within(list).getAllByText(en.statusVerdict.failed).length).toBeGreaterThan(0);
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
		expect(within(list).getByText(en.gaps.tokens.metro_realtime)).toBeInTheDocument();
		expect(within(list).queryByText('metro_realtime')).toBeNull();
	});

	it('renders EVERY un-threaded methodology string, iterating the FULL dict (labelled + key-fallback)', () => {
		render(HealthStatus);
		const list = screen.getByRole('list', { name: en.pipelineNotes.listLabel });
		// Un-threaded keys with an explicit label appear by label + verbatim string.
		expect(within(list).getByText(en.pipelineNotes.labels.network_no_data)).toBeInTheDocument();
		expect(within(list).getByText(en.pipelineNotes.labels.alert_breakdown)).toBeInTheDocument();
		// An S10-noted key that DID get a label (wilson_z) renders by its label.
		expect(within(list).getByText(en.pipelineNotes.labels.wilson_z)).toBeInTheDocument();
		expect(
			within(list).getByText(richProvenance.methodology!.wilson_z as string),
		).toBeInTheDocument();
		// An UNKNOWN key with no label still renders — the humanized key is the label
		// (never dropped): "some_new_key" → "some new key".
		expect(within(list).getByText('some new key')).toBeInTheDocument();
		expect(
			within(list).getByText(richProvenance.methodology!.some_new_key as string),
		).toBeInTheDocument();
		// A THREADED key (otp_definition → /metrics card) does NOT appear here.
		expect(
			within(list).queryByText(richProvenance.methodology!.otp_definition as string),
		).toBeNull();
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
		expect(screen.getByText(en.conformance.section)).toBeInTheDocument();
		const list = screen.getByRole('list', { name: en.conformance.membersListLabel });
		for (const member of richProvenance.conformance!.unknown_members!) {
			expect(within(list).getByText(member)).toBeInTheDocument();
		}
		const extra = screen
			.getByText(en.conformance.extraRowsLabel)
			.closest('[data-slot="metric-display"]');
		expect(within(extra as HTMLElement).getByText('1,234')).toBeInTheDocument();
	});
});

describe('HealthStatus — S11 pipeline lanes', () => {
	it('renders one row per publish lane (live / static / rollup) + the MAINTENANCE not-applicable row', () => {
		render(HealthStatus);
		const list = screen.getByRole('list', { name: en.lanes.listLabel });
		// The three DB-heartbeat lanes + the maintenance row are all present by label.
		expect(within(list).getByText(en.lanes.laneLabel.live)).toBeInTheDocument();
		expect(within(list).getByText(en.lanes.laneLabel.static)).toBeInTheDocument();
		expect(within(list).getByText(en.lanes.laneLabel.rollup)).toBeInTheDocument();
		expect(within(list).getByText(en.lanes.laneLabel.maintenance)).toBeInTheDocument();
		// The gate explainer states WHAT the gate checks (honest, not alarmist).
		expect(screen.getByText(en.lanes.gateExplain)).toBeInTheDocument();
	});

	it('renders each lane gate verdict as a chip (pass / warn), and honest-NULL for a pre-0078 lane', () => {
		render(HealthStatus);
		const live = document.querySelector('[data-slot="lane-row"][data-lane="live"]') as HTMLElement;
		const stat = document.querySelector(
			'[data-slot="lane-row"][data-lane="static"]',
		) as HTMLElement;
		const rollup = document.querySelector(
			'[data-slot="lane-row"][data-lane="rollup"]',
		) as HTMLElement;
		// live gate PASSED; static gate has WARNINGS.
		expect(within(live).getByText(en.lanes.gateVerdict.pass)).toBeInTheDocument();
		expect(within(stat).getByText(en.lanes.gateVerdict.warn)).toBeInTheDocument();
		// The pre-0078 rollup lane shows the honest-absence chip, NOT a fabricated pass.
		const rollupGate = rollup.querySelector('[data-slot="lane-gate"]') as HTMLElement;
		expect(rollupGate.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(within(rollupGate).queryByText(en.lanes.gateVerdict.pass)).toBeNull();
	});

	it('renders file counts for a lane that reports them, honest-absence when it does not', () => {
		render(HealthStatus);
		const stat = document.querySelector(
			'[data-slot="lane-row"][data-lane="static"]',
		) as HTMLElement;
		expect(within(stat).getByText(en.lanes.filesCount('118', '120'))).toBeInTheDocument();
		// The rollup lane reports NO counts → the honest-absence chip, never 0 of 0.
		const rollup = document.querySelector(
			'[data-slot="lane-row"][data-lane="rollup"]',
		) as HTMLElement;
		const files = rollup.querySelector('[data-slot="lane-files"]') as HTMLElement;
		expect(files.querySelector('[data-slot="absent-value"]')).not.toBeNull();
	});

	it('renders the MAINTENANCE row as honest not-applicable (no heartbeat, plain reason)', () => {
		render(HealthStatus);
		const na = document.querySelector('[data-slot="lane-not-applicable"]') as HTMLElement;
		expect(na).not.toBeNull();
		expect(within(na).getByText(en.lanes.notApplicable)).toBeInTheDocument();
		expect(within(na).getByText(en.lanes.maintenanceReason)).toBeInTheDocument();
	});

	it('stands the lanes section DOWN entirely on a LEGACY publish (data_health absent)', () => {
		// A legacy publish serves no data_health.json → getDataHealth resolves null →
		// the section renders nothing (not even the maintenance row).
		dataHealthFixture = null;
		render(HealthStatus);
		expect(screen.queryByRole('list', { name: en.lanes.listLabel })).toBeNull();
		expect(screen.queryByText(en.lanes.section)).toBeNull();
	});
});

describe('HealthStatus — S11 build-accountability envelope', () => {
	it('renders the PROVENANCE envelope (the run that produced the page body), never the live stamp', () => {
		// S11 review F1-web: the copy says the stamp produced everything on this
		// page; the body (freshness/sources/retention/conformance) is provenance,
		// so the provenance stamp is primary. The live run's stamp belongs to the
		// lanes section only.
		render(HealthStatus);
		expect(screen.getByText(en.envelope.section)).toBeInTheDocument();
		expect(screen.getByText('gen-prov-xyz')).toBeInTheDocument();
		expect(screen.queryByText('gen-live-abc')).toBeNull();
		expect(screen.getByText(en.envelope.generationIdExplain)).toBeInTheDocument();
		const schema = screen
			.getByText(en.envelope.schemaVersionLabel)
			.closest('[data-slot="metric-display"]');
		expect(within(schema as HTMLElement).getByText('3')).toBeInTheDocument();
		const method = screen
			.getByText(en.envelope.methodologyVersionLabel)
			.closest('[data-slot="metric-display"]');
		expect(within(method as HTMLElement).getByText('historic-2')).toBeInTheDocument();
	});

	it('falls back to data_health envelope fields when provenance lacks them', () => {
		// A provenance payload predating the envelope fields → the selector fills
		// each field from data_health, so the section still renders.
		provenanceFixture = stripEnvelope(richProvenance);
		render(HealthStatus);
		expect(screen.getByText('gen-live-abc')).toBeInTheDocument();
		const schema = screen
			.getByText(en.envelope.schemaVersionLabel)
			.closest('[data-slot="metric-display"]');
		expect(within(schema as HTMLElement).getByText('1')).toBeInTheDocument();
	});

	it('renders the styled honest-absence for envelope fields absent from BOTH sources', () => {
		// Neither payload carries envelope fields → the section stands down entirely.
		dataHealthFixture = { generated_utc: iso('2026-06-19T12:00:00Z') };
		provenanceFixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			conformance: null,
		};
		render(HealthStatus);
		expect(screen.queryByText(en.envelope.section)).toBeNull();
	});
});

describe('HealthStatus — honesty (sections stand down when absent)', () => {
	it('omits gaps / retention / conformance sections entirely when their data is absent', () => {
		provenanceFixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [{ feed: 'realtime_vehicles', status: 'succeeded', age_s: 60 }],
			sources: [],
			gaps: [],
			retention: {},
			conformance: null,
		};
		dataHealthFixture = null;
		render(HealthStatus);
		expect(screen.getByRole('list', { name: en.freshness.listLabel })).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: en.sources.listLabel })).toBeNull();
		expect(screen.queryByText(en.gaps.section)).toBeNull();
		expect(screen.queryByText(en.pipelineNotes.section)).toBeNull();
		expect(screen.queryByText(en.retention.section)).toBeNull();
		expect(screen.queryByText(en.conformance.section)).toBeNull();
	});

	it('stands the Pipeline-notes section down when every methodology key is already threaded', () => {
		provenanceFixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			methodology: { otp_definition: 'on-time band', cancellation: 'canceled / observed' },
			conformance: null,
		};
		dataHealthFixture = null;
		render(HealthStatus);
		expect(screen.queryByText(en.pipelineNotes.section)).toBeNull();
		expect(screen.queryByRole('list', { name: en.pipelineNotes.listLabel })).toBeNull();
	});

	it('renders a conformance verdict but no disclosure when there are no unknown members', () => {
		provenanceFixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			conformance: { status: 'conformant', extra_row_count: 0, unknown_members: [] },
		};
		dataHealthFixture = null;
		render(HealthStatus);
		expect(screen.getByText(en.conformance.section)).toBeInTheDocument();
		expect(screen.queryByText(en.conformance.detailsTitle)).toBeNull();
	});

	it('renders the styled honest-absence chip (never a fabricated 0) when extra_row_count is null', () => {
		provenanceFixture = {
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			conformance: { status: 'out_of_norm', unknown_members: ['zone_id'] },
		};
		dataHealthFixture = null;
		render(HealthStatus);
		const extra = screen
			.getByText(en.conformance.extraRowsLabel)
			.closest('[data-slot="metric-display"]') as HTMLElement;
		const chip = extra.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('data-tone')).toBe('unknown');
		expect(within(extra).queryByText('0')).toBeNull();
	});
});
