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

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as renderSvelte, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DataHealth, HistoricAvailabilityIndex, IsoUtc, Provenance } from '$lib/v1/schemas';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import { createSurfaceHarness } from '../../../tests/surfaceHarness';
import HealthStatus from './HealthStatus.svelte';
import { copy } from './health.copy';

vi.mock('@testing-library/svelte', { spy: true });

const en = copy.en;
const localeContext = (locale: 'en' | 'fr') =>
	new Map([[Symbol.for('transit.i18n.locale'), () => locale]]);
const overviewCopy = {
	en: {
		title: 'Overview',
		dailyRecord: 'Daily record',
		liveFeeds: 'Live feeds',
		retainedHistory: 'Retained history',
	},
	fr: {
		title: 'Vue d’ensemble',
		dailyRecord: 'Bilan quotidien',
		liveFeeds: 'Flux en direct',
		retainedHistory: 'Historique conservé',
	},
} as const;

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

const richHistory: HistoricAvailabilityIndex = {
	generated_utc: iso('2026-07-14T12:00:00Z'),
	families: [
		{
			family: 'alerts',
			selection_mode: 'range',
			index_path: 'historic/alerts/index.json',
			first_available_date: '2026-05-20',
			last_available_date: '2026-07-14',
		},
		{
			family: 'receipts',
			selection_mode: 'date',
			index_path: 'historic/receipts/index.json',
			first_available_date: '2026-06-12',
			last_available_date: '2026-07-13',
		},
		{
			family: 'network',
			selection_mode: 'range',
			index_path: 'historic/history/network/index.json',
			first_available_date: '2026-05-01',
			last_available_date: '2026-07-13',
		},
		{
			family: 'lines',
			selection_mode: 'range',
			index_path: 'historic/history/lines/index.json',
			first_available_date: '2026-05-01',
			last_available_date: '2026-07-13',
		},
		{
			family: 'stops',
			selection_mode: 'range',
			index_path: 'historic/history/stops/index.json',
			first_available_date: '2026-05-08',
			last_available_date: '2026-07-13',
		},
		{
			family: 'hotspots',
			selection_mode: 'date',
			index_path: 'historic/history/hotspots/index.json',
			first_available_date: '2026-06-01',
			last_available_date: '2026-07-13',
		},
		{
			family: 'repeat_offenders',
			selection_mode: 'date',
			index_path: 'historic/history/repeat_offenders/index.json',
			first_available_date: '2026-06-01',
			last_available_date: '2026-07-13',
		},
	],
};

interface ResourceState<T> {
	data: T | null;
	error: Error | null;
	loading: boolean;
	settled: boolean;
}

const ready = <T>(data: T | null): ResourceState<T> => ({
	data,
	error: null,
	loading: false,
	settled: true,
});

// Independent resource surfaces let the matrix tests exercise daily and live
// loading/error states without coupling one document to the other.
let provenanceState: ResourceState<Provenance> = ready(richProvenance);

/** A provenance payload predating the PayloadEnvelope fields (legacy publish). */
function stripEnvelope(prov: Provenance): Provenance {
	const { schema_version, methodology_version, publish_generation_id, ...rest } = prov;
	void schema_version;
	void methodology_version;
	void publish_generation_id;
	return rest as Provenance;
}
let dataHealthState: ResourceState<DataHealth> = ready(richDataHealth);
let historyState: ResourceState<HistoricAvailabilityIndex> = ready(richHistory);
const historyReload = vi.fn();

vi.mock('$lib/nav', async () => ({ layout: { isDesktop: true } }));

// The barrel mock exports the two fetchers (distinct spy identities so the resource
// mock can tell them apart) + the freshness helper HealthStatus imports. The spies
// live in a vi.hoisted block so both the (hoisted) vi.mock factories AND the test
// bodies can reference them. freshnessRelative delegates to the real module so
// relative-age math stays honest.
const { getProvenance, getDataHealth, getHistoricAvailability } = vi.hoisted(() => ({
	getProvenance: vi.fn(),
	getDataHealth: vi.fn(),
	getHistoricAvailability: vi.fn(),
}));
vi.mock('$lib/v1', async () => {
	const freshness = await import('$lib/v1/freshness');
	return {
		getProvenance,
		getDataHealth,
		getHistoricAvailability,
		freshnessRelative: freshness.freshnessRelative,
	};
});
vi.mock('$lib/v1/repositories/provenance', () => ({
	getProvenance,
}));
vi.mock('$lib/v1/repositories/dataHealth', () => ({
	getDataHealth,
}));
vi.mock('$lib/v1/repositories/historic', () => ({
	getHistoricAvailability,
}));

// createResource is mocked to return the fixture for the matching fetcher. The
// component owns the arrow fetchers, so we can't compare identity — instead we
// INVOKE the fetcher (harmless: the stubbed getters return undefined) and route by
// which spy fired. getDataHealth firing → the data-health resource; else provenance.
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (fetcher: () => unknown) => {
		getProvenance.mockClear();
		getDataHealth.mockClear();
		getHistoricAvailability.mockClear();
		try {
			fetcher();
		} catch {
			// fetchers are stubbed to return undefined; ignore.
		}
		const isDataHealth = getDataHealth.mock.calls.length > 0;
		const isHistory = getHistoricAvailability.mock.calls.length > 0;
		const state = isHistory ? historyState : isDataHealth ? dataHealthState : provenanceState;
		return {
			...state,
			reload: isHistory ? historyReload : vi.fn(),
		};
	},
}));

function resetHealthSurfaceState(): void {
	provenanceState = ready(richProvenance);
	dataHealthState = ready(richDataHealth);
	historyState = ready(richHistory);
	historyReload.mockReset();
	getProvenance.mockReset();
	getDataHealth.mockReset();
	getHistoricAvailability.mockReset();
	quietModeStore.resetForTest();
}

const healthSurface = createSurfaceHarness({
	storage: [
		{
			port: sessionStorage,
			keys: ['transit.persisted:health-conformance-members'],
			prefixes: ['transit.persisted:status-'],
		},
	],
	resetters: [resetHealthSurfaceState],
	mount: renderSvelte,
});
const render = healthSurface.mount;

beforeEach(() => healthSurface.reset());

afterAll(() => {
	expect(vi.mocked(renderSvelte).mock.calls.length).toBeLessThanOrEqual(38);
});

describe('HealthStatus — full manifest render', () => {
	it('renders the shared status article header with truthful meta, body lede, and no default band', () => {
		const { container } = render(HealthStatus);
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;

		expect(header).not.toBeNull();
		expect(within(header).getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(within(header).getByRole('link', { name: en.article.back })).toHaveAttribute(
			'href',
			'/',
		);
		const keywords = within(header).getByRole('list', { name: en.article.tagsAria });
		for (const keyword of en.article.tags) {
			expect(within(keywords).getByText(keyword)).toBeInTheDocument();
		}
		expect(header).toHaveTextContent(en.article.sections(9));
		expect(header).toHaveTextContent('2026');
		expect(container.querySelector('[data-slot="detail-shell-header"]')).toBeNull();
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		expect(within(center).getByText(en.lede)).toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-shell"]')?.parentElement).toBe(container);
	});

	it('renders the exact two controls and one numbered card per present pipeline section', async () => {
		const { container } = render(HealthStatus);
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
		expect(within(header).getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
		expect(
			within(header).getByRole('button', { name: 'Always start collapsed' }),
		).toBeInTheDocument();

		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		for (const title of [
			en.lanes.section,
			en.freshness.section,
			en.sources.section,
			en.gaps.section,
			en.pipelineNotes.section,
			en.retention.section,
			en.conformance.section,
			en.envelope.section,
			en.historyCoverage.section,
		]) {
			const trigger = within(center).getByRole('button', { name: title });
			const card = trigger.closest('[data-slot="card"]') as HTMLElement;
			expect(card).not.toBeNull();
			expect(within(card).getAllByText(title)).toHaveLength(1);
		}

		await fireEvent.click(within(header).getByRole('button', { name: 'Collapse all' }));
		for (const trigger of center.querySelectorAll('button.section-header')) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
	});

	it('mounts the retained-history card and matching ToC entry from the same valid inventory', () => {
		const { container } = render(HealthStatus);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;

		expect(
			within(center).getByRole('button', { name: en.historyCoverage.section }),
		).toBeInTheDocument();
		expect(
			within(left).getByRole('button', { name: en.historyCoverage.section }),
		).toBeInTheDocument();
		expect(
			within(center).getByRole('table', { name: en.historyCoverage.tableLabel }),
		).toBeInTheDocument();
	});

	it('uses one stable locale-free disclosure key for retained-history coverage', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/health/HealthStatus.svelte'),
			'utf8',
		);

		expect(source).toContain('sectionKey="status-card-health-history-coverage"');
		expect(source).toContain('anchor="health-history-coverage"');
		expect(source).not.toContain('status-card-health-history-coverage-fr');
	});

	it('opts every Status section and stat card into title-only article-summary headers', () => {
		const { container } = render(HealthStatus);
		const sectionCards = Array.from(
			container.querySelectorAll<HTMLElement>('.health-sections > [data-slot="card"]'),
		);
		const railCards = Array.from(
			container.querySelectorAll<HTMLElement>('.health-stat-rail > [data-slot="card"]'),
		);

		expect(sectionCards).toHaveLength(10);
		expect(railCards).toHaveLength(2);
		for (const card of [...sectionCards, ...railCards]) {
			expect(card).toHaveAttribute('data-header-variant', 'article-summary');
			const heading = card.querySelector('h2.section-heading') as HTMLHeadingElement;
			expect(heading).not.toBeNull();
			expect(heading.children).toHaveLength(1);
			const trigger = heading.firstElementChild as HTMLButtonElement;
			expect(trigger).toHaveClass('section-header--title-only');
			expect(trigger).not.toHaveAttribute('aria-describedby');
			expect(card.querySelector('.section-subtitle--article-summary')).toBeNull();
		}
		expect(
			container.querySelector('.health-toc-rail [data-header-variant="article-summary"]'),
		).toBeNull();
	});

	it('keeps status article meta honestly absent when no status document is available', () => {
		provenanceState = ready<Provenance>(null);
		dataHealthState = ready<DataHealth>(null);
		historyState = ready<HistoricAvailabilityIndex>(null);
		const { container } = render(HealthStatus);
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;

		expect(header).not.toBeNull();
		expect(header.querySelector('.header__meta')?.children).toHaveLength(0);
		expect(header).not.toHaveTextContent('0 sections');
	});

	it('labels daily and live timestamps separately when the two status documents diverge', () => {
		provenanceState = ready({
			...richProvenance,
			generated_utc: iso('2026-06-19T06:00:00Z'),
		});
		dataHealthState = ready({
			...richDataHealth,
			generated_utc: iso('2026-06-19T12:00:00Z'),
		});
		const { container } = render(HealthStatus);
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;

		expect(within(header).getByText('DAILY RECORD AS OF')).toBeInTheDocument();
		expect(within(header).getByText('LIVE FEEDS AS OF')).toBeInTheDocument();
		expect(Array.from(header.querySelectorAll('time')).map((time) => time.dateTime)).toEqual([
			'2026-06-19T06:00:00Z',
			'2026-06-19T12:00:00Z',
		]);
	});

	it('keeps each French source label paired with its timestamp', () => {
		provenanceState = ready({
			...richProvenance,
			generated_utc: iso('2026-06-19T06:00:00Z'),
		});
		dataHealthState = ready({
			...richDataHealth,
			generated_utc: iso('2026-06-19T12:00:00Z'),
		});
		const { container } = render(HealthStatus, { context: localeContext('fr') });
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
		const pairs = Array.from(header.querySelectorAll('.header__meta-pair'));

		expect(pairs).toHaveLength(2);
		expect(pairs[0]).toHaveTextContent(copy.fr.article.dailyAsOf);
		expect(pairs[0].querySelector('time')).toHaveAttribute('datetime', '2026-06-19T06:00:00Z');
		expect(pairs[1]).toHaveTextContent(copy.fr.article.liveAsOf);
		expect(pairs[1].querySelector('time')).toHaveAttribute('datetime', '2026-06-19T12:00:00Z');
	});

	it('keeps EN and FR status keywords distinct and removes internal /v1 jargon from the lede', () => {
		expect(copy.en.article.tags).toEqual(['data', 'feeds', 'freshness', 'known gaps']);
		expect(copy.fr.article.tags).toEqual(['données', 'flux', 'fraîcheur', 'lacunes connues']);
		expect(copy.en.article.sections(1)).toBe('1 section');
		expect(copy.fr.article.sections(1)).toBe('1 section');
		expect(copy.en.lede).not.toContain('/v1');
		expect(copy.fr.lede).not.toContain('/v1');
	});

	it('uses the exact article prose and compact rail typography contract', () => {
		const src = readFileSync(
			resolve(process.cwd(), 'src/lib/features/health/HealthStatus.svelte'),
			'utf8',
		);
		expect(src).toMatch(
			/\.health-lede\s*\{[\s\S]*?font-size:\s*var\(--text-detail-body-mobile\)[\s\S]*?line-height:\s*1\.8/,
		);
		expect(src).toMatch(
			/@media\s*\(min-width:\s*1024px\)[\s\S]*?\.health-lede\s*\{[\s\S]*?font-size:\s*var\(--text-detail-body-desktop\)[\s\S]*?line-height:\s*1\.9/,
		);
		expect(src).toMatch(
			/\.health-stat__sub\s*\{[\s\S]*?font-size:\s*var\(--text-small\)[\s\S]*?line-height:\s*1\.45/,
		);
	});

	it('uses one wide left rail and renders At a glance once below its navigation', () => {
		const { container } = render(HealthStatus);
		const grid = container.querySelector('.detail-shell-grid') as HTMLElement;
		const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;
		const toc = left.querySelector('.health-toc-rail') as HTMLElement;
		const summary = left.querySelector('[data-slot="health-at-a-glance"]') as HTMLElement;

		expect(grid).toHaveClass('detail-shell-grid--two');
		expect(container.querySelectorAll('[data-slot="detail-shell-left"]')).toHaveLength(1);
		expect(container.querySelector('[data-slot="detail-shell-right"]')).toBeNull();
		expect(container.querySelector('[data-slot="detail-shell-mobile-summary"]')).toBeNull();
		expect(container.querySelectorAll('.health-stat-rail')).toHaveLength(1);
		expect(summary).toHaveAccessibleName(en.statRail.label);
		expect(toc.compareDocumentPosition(summary)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('renders approved Lanes and Feeds icons once in the left rail summary', () => {
		const { container } = render(HealthStatus);
		const rail = container.querySelector('.health-stat-rail') as HTMLElement;

		expect(rail.querySelectorAll('[data-testid="section-grid-icon"]')).toHaveLength(1);
		expect(rail.querySelectorAll('[data-testid="section-list-icon"]')).toHaveLength(1);
	});

	it('independently closes Lanes while Feeds stays open in the single summary', async () => {
		const { container } = render(HealthStatus);
		const rail = container.querySelector('.health-stat-rail') as HTMLElement;
		const lanes = within(rail).getByRole('button', { name: en.statRail.lanes.title });
		const feeds = within(rail).getByRole('button', { name: en.statRail.feeds.title });
		const laneCard = lanes.closest('[data-slot="card"]') as HTMLElement;

		await fireEvent.click(lanes);

		expect(lanes).toHaveAttribute('aria-expanded', 'false');
		expect(laneCard.querySelector('.section-body')).toHaveAttribute('data-state', 'closed');
		expect(feeds).toHaveAttribute('aria-expanded', 'true');
	});

	it('uses the shared ArticleSectionStack for primary cards without a page-owned card gap', () => {
		const { container } = render(HealthStatus);
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/health/HealthStatus.svelte'),
			'utf8',
		);
		const stack = container.querySelector('[data-slot="article-section-stack"]');

		expect(stack).toHaveClass('health-sections');
		expect(source).toContain('ArticleSectionStack');
		expect(source).not.toMatch(
			/\.health-sections\s*\{[^}]*?(?:display:\s*flex|flex-direction:\s*column|gap:)/s,
		);
	});

	it('renders the surface head + a semantic neutral update time, never the live "LIVE" chip', () => {
		const { container } = render(HealthStatus);
		expect(screen.getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(screen.getByText(en.asOf)).toBeInTheDocument();
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
		const time = header.querySelector('time');
		expect(time).not.toBeNull();
		expect(time).toHaveAttribute('datetime', richProvenance.generated_utc);
		expect(within(header).queryByText('LIVE')).toBeNull();
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
		expect(src).toMatch(
			/createResource\(\(\) => getHistoricAvailability\(\),\s*\{\s*freshness:\s*true\s*\}\)/,
		);
	});

	it('states the live cadence as a 30-second operating target rather than a browser guarantee', () => {
		expect(copy.en.lanes.cadence.live).toMatch(/30-second operating target/i);
		expect(copy.en.lanes.cadence.live).toMatch(/may take longer/i);
		expect(copy.fr.lanes.cadence.live).toMatch(/cible d’exploitation de 30 secondes/i);
		expect(copy.fr.lanes.cadence.live).toMatch(/peut prendre plus de temps/i);
		expect(copy.en.lanes.cadence.live).not.toContain('~57');
		expect(copy.fr.lanes.cadence.live).not.toContain('~57');
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
		const { container } = render(HealthStatus);
		// The caption also appears in the left-rail ToC now (P5.3b), so scope the
		// section-heading assertion to the center sections column.
		const sections = container.querySelector('[data-testid="health-sections"]') as HTMLElement;
		expect(within(sections).getByText(en.conformance.section)).toBeInTheDocument();
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

describe('HealthStatus — Overview and independent resources', () => {
	it('keeps Overview visible with three labelled loading regions', () => {
		provenanceState = { data: null, error: null, loading: true, settled: false };
		dataHealthState = { data: null, error: null, loading: true, settled: false };
		historyState = { data: null, error: null, loading: true, settled: false };
		const { container } = render(HealthStatus);

		const overview = screen
			.getByRole('button', { name: overviewCopy.en.title })
			.closest('[data-slot="card"]') as HTMLElement;
		expect(within(overview).getByText(en.lede)).toBeInTheDocument();
		expect(within(overview).getByText(overviewCopy.en.dailyRecord)).toBeInTheDocument();
		expect(within(overview).getByText(overviewCopy.en.liveFeeds)).toBeInTheDocument();
		expect(within(overview).getByText(overviewCopy.en.retainedHistory)).toBeInTheDocument();
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
		expect(header.querySelector('.header__meta')).toHaveAttribute('data-pending', 'true');
		expect(header.querySelector('.header__meta-skeleton')).toHaveAttribute('aria-hidden', 'true');
	});

	it('does not let daily failure hide valid live cards', () => {
		provenanceState = {
			data: null,
			error: new Error('daily down'),
			loading: false,
			settled: true,
		};
		dataHealthState = ready(richDataHealth);
		const { container } = render(HealthStatus);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;

		expect(within(center).getByRole('button', { name: en.lanes.section })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: en.statRail.lanes.title })).toBeInTheDocument();
		expect(screen.getByRole('alert')).toBeInTheDocument();
	});

	it('does not let live failure hide valid daily cards', () => {
		provenanceState = ready(richProvenance);
		dataHealthState = {
			data: null,
			error: new Error('live down'),
			loading: false,
			settled: true,
		};
		const { container } = render(HealthStatus);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;

		expect(within(center).getByRole('button', { name: en.freshness.section })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: en.statRail.feeds.title })).toBeInTheDocument();
		expect(screen.getByRole('alert')).toBeInTheDocument();
	});

	it('keeps a history-root failure retryable without mounting a false card or ToC entry', async () => {
		historyState = {
			data: null,
			error: new Error('history down'),
			loading: false,
			settled: true,
		};
		const { container } = render(HealthStatus);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;
		const overview = within(center)
			.getByText(overviewCopy.en.retainedHistory)
			.closest('.health-resource-state') as HTMLElement;

		expect(within(center).queryByRole('button', { name: en.historyCoverage.section })).toBeNull();
		expect(within(left).queryByRole('button', { name: en.historyCoverage.section })).toBeNull();
		expect(overview.querySelector('[data-variant="error-v1"]')).not.toBeNull();
		await fireEvent.click(within(overview).getByRole('button', { name: 'Retry' }));
		expect(historyReload).toHaveBeenCalledOnce();
	});

	it('stands a null or legacy history root down while keeping its honest Overview state', () => {
		for (const history of [null, { generated_utc: iso('2026-07-14T12:00:00Z') }] as const) {
			historyState = ready(history as HistoricAvailabilityIndex | null);
			const { container, unmount } = render(HealthStatus);
			const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
			const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;
			const overview = within(center)
				.getByText(overviewCopy.en.retainedHistory)
				.closest('.health-resource-state') as HTMLElement;

			expect(within(center).queryByRole('button', { name: en.historyCoverage.section })).toBeNull();
			expect(within(left).queryByRole('button', { name: en.historyCoverage.section })).toBeNull();
			expect(overview.querySelector('[data-variant="empty"]')).not.toBeNull();
			unmount();
		}
	});

	it('keeps the single Status summary card independently collapsible', async () => {
		render(HealthStatus);
		const lanes = screen.getByRole('button', { name: en.statRail.lanes.title });

		await fireEvent.click(lanes);

		expect(lanes).toHaveAttribute('aria-expanded', 'false');
	});

	it('renders the French Overview and resource-region labels from locale context', () => {
		provenanceState = { data: null, error: null, loading: true, settled: false };
		dataHealthState = { data: null, error: null, loading: true, settled: false };
		historyState = { data: null, error: null, loading: true, settled: false };
		render(HealthStatus, { context: localeContext('fr') });

		const overview = screen
			.getByRole('button', { name: overviewCopy.fr.title })
			.closest('[data-slot="card"]') as HTMLElement;
		expect(within(overview).getByText(overviewCopy.fr.dailyRecord)).toBeInTheDocument();
		expect(within(overview).getByText(overviewCopy.fr.liveFeeds)).toBeInTheDocument();
		expect(within(overview).getByText(overviewCopy.fr.retainedHistory)).toBeInTheDocument();
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
		dataHealthState = ready<DataHealth>(null);
		const { container } = render(HealthStatus);
		expect(screen.queryByRole('list', { name: en.lanes.listLabel })).toBeNull();
		expect(screen.queryByText(en.lanes.section)).toBeNull();
		const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;
		expect(within(left).getByText(/SEC\s*02\s*\/\s*09/)).toBeInTheDocument();
	});
});

describe('HealthStatus — S11 build-accountability envelope', () => {
	it('renders the PROVENANCE envelope (the run that produced the page body), never the live stamp', () => {
		// S11 review F1-web: the copy says the stamp produced everything on this
		// page; the body (freshness/sources/retention/conformance) is provenance,
		// so the provenance stamp is primary. The live run's stamp belongs to the
		// lanes section only.
		const { container } = render(HealthStatus);
		// The caption also appears in the left-rail ToC now (P5.3b), so scope the
		// section-heading assertion to the center sections column.
		const sections = container.querySelector('[data-testid="health-sections"]') as HTMLElement;
		expect(within(sections).getByText(en.envelope.section)).toBeInTheDocument();
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
		provenanceState = ready(stripEnvelope(richProvenance));
		render(HealthStatus);
		expect(screen.getByText('gen-live-abc')).toBeInTheDocument();
		const schema = screen
			.getByText(en.envelope.schemaVersionLabel)
			.closest('[data-slot="metric-display"]');
		expect(within(schema as HTMLElement).getByText('1')).toBeInTheDocument();
	});

	it('renders the styled honest-absence for envelope fields absent from BOTH sources', () => {
		// Neither payload carries envelope fields → the section stands down entirely.
		dataHealthState = ready({ generated_utc: iso('2026-06-19T12:00:00Z') });
		provenanceState = ready({
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			conformance: null,
		});
		render(HealthStatus);
		expect(screen.queryByText(en.envelope.section)).toBeNull();
	});
});

describe('HealthStatus — honesty (sections stand down when absent)', () => {
	it('omits gaps / retention / conformance sections entirely when their data is absent', () => {
		provenanceState = ready({
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [{ feed: 'realtime_vehicles', status: 'succeeded', age_s: 60 }],
			sources: [],
			gaps: [],
			retention: {},
			conformance: null,
		});
		dataHealthState = ready<DataHealth>(null);
		render(HealthStatus);
		expect(screen.getByRole('list', { name: en.freshness.listLabel })).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: en.sources.listLabel })).toBeNull();
		expect(screen.queryByText(en.gaps.section)).toBeNull();
		expect(screen.queryByText(en.pipelineNotes.section)).toBeNull();
		expect(screen.queryByText(en.retention.section)).toBeNull();
		expect(screen.queryByText(en.conformance.section)).toBeNull();
	});

	it('stands the Pipeline-notes section down when every methodology key is already threaded', () => {
		provenanceState = ready({
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			methodology: { otp_definition: 'on-time band', cancellation: 'canceled / observed' },
			conformance: null,
		});
		dataHealthState = ready<DataHealth>(null);
		render(HealthStatus);
		expect(screen.queryByText(en.pipelineNotes.section)).toBeNull();
		expect(screen.queryByRole('list', { name: en.pipelineNotes.listLabel })).toBeNull();
	});

	it('renders a conformance verdict but no disclosure when there are no unknown members', () => {
		provenanceState = ready({
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			conformance: { status: 'conformant', extra_row_count: 0, unknown_members: [] },
		});
		dataHealthState = ready<DataHealth>(null);
		const { container } = render(HealthStatus);
		// The caption also appears in the left-rail ToC now (P5.3b), so scope the
		// section-heading assertion to the center sections column.
		const sections = container.querySelector('[data-testid="health-sections"]') as HTMLElement;
		expect(within(sections).getByText(en.conformance.section)).toBeInTheDocument();
		expect(screen.queryByText(en.conformance.detailsTitle)).toBeNull();
	});

	it('renders the styled honest-absence chip (never a fabricated 0) when extra_row_count is null', () => {
		provenanceState = ready({
			generated_utc: iso('2026-06-19T12:00:00Z'),
			freshness: [],
			sources: [],
			gaps: [],
			retention: {},
			conformance: { status: 'out_of_norm', unknown_members: ['zone_id'] },
		});
		dataHealthState = ready<DataHealth>(null);
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
