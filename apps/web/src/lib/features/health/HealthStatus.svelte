<!--
  HealthStatus — the /status (data-health) surface screen.

  Thin ORCHESTRATOR over two live resources + one mapping pass. Every derivation
  lives in ./selectors and every block in ./sections; this file only fetches,
  maps, and lays the sections out.

  P5.4c RE-SEAT — the surface uses the shared DetailShell spine (same detail
  architecture as /metrics) and the shared ArticleHeader cover: circuit grid,
  ManifestoCanvas, watermark, category rule, keywords and truthful dated meta.
  The lede opens the body column; DetailShell adds the hazard tape.
    · BODY → DetailShell (3-col at ≥1024): LEFT = the numbered ToC over the (up
      to) 8 sections + a SEC n/m readout; CENTER = the existing 8 gated sections
      (real headings from stage 1, unchanged); RIGHT = per-feed stat cards (lanes
      passing / feeds fresh). Mobile: single column, the stat cards reflow to a top
      summary strip, the ToC becomes the floating TocPill.

  The 8 sections keep their pipeline order (NO reorder — that is P5.3d) and there
  is NO aggregate-verdict TerminalPanel yet (that is P5.3c). Each section still
  STANDS DOWN when its slice is empty; the ToC + stat rail derive from the SAME
  presence flags so a stood-down section is simply absent from the nav.

  Two resources, BOTH freshness:true — so the shared dataPulse epoch re-runs both
  on a new publish (auto-refresh, no polling). HONESTY: a null/absent slice stands
  its section DOWN or shows the styled absence, never a fabricated value. DOCTRINE:
  status marks ride the dataviz status scale (StatusDot), never --primary.
-->
<script lang="ts">
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { getProvenance, getDataHealth, freshnessRelative, type Provenance } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { formatRelativeSeconds, formatUtc } from '$lib/utils/time';
	import { METHODOLOGY_METRIC_KEY } from '$lib/features/metrics/metrics.content';
	import { ArticleHeader, DetailShell, type ArticleMetaEntry } from '$lib/components/layout';
	import { ResourceBoundary } from '$lib/components/surface';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import { TocNav, type TocEntry } from '$lib/components/shared';
	import { copy as COPY } from './health.copy';
	import {
		verdictFor as verdictForRaw,
		freshnessOf,
		sourcesOf,
		gapsOf,
		pipelineNotesOf,
		retentionOf,
	} from './selectors/provenanceViews';
	import { selectLaneRows, type LaneLabels, type LaneRow } from './selectors/laneHealth';
	import { selectEnvelope } from './selectors/envelope';
	import SectionLanes from './sections/SectionLanes.svelte';
	import SectionFreshness from './sections/SectionFreshness.svelte';
	import SectionSources from './sections/SectionSources.svelte';
	import SectionGaps from './sections/SectionGaps.svelte';
	import SectionNotes from './sections/SectionNotes.svelte';
	import SectionRetention from './sections/SectionRetention.svelte';
	import SectionConformance from './sections/SectionConformance.svelte';
	import SectionEnvelope from './sections/SectionEnvelope.svelte';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The two honesty documents. `freshness: true` on BOTH wires the shared
	// newest-data contribution AND the dataPulse-epoch auto-refresh: a new publish
	// bumps the epoch and both resources re-run, so /status advances with no polling.
	const provenance = createResource(() => getProvenance(), { freshness: true });
	// data_health.json lives on the LIVE lane; null when not published yet (legacy
	// manifest / 404) → the lanes section stands down honestly.
	const dataHealth = createResource(() => getDataHealth(), { freshness: true });

	// ── Localized pass-through helpers handed to the sections ────────────────────
	function verdictFor(status: string | null | undefined) {
		return verdictForRaw(status, t.statusVerdict);
	}
	/** Humanize a non-negative age in seconds, or the localized "no age" note. */
	function humanizeAge(ageS: number | null | undefined): string {
		return ageS == null ? t.freshness.noAge : formatRelativeSeconds(ageS, locale);
	}
	/** Relative last-loaded stamp from an ISO string, or the localized fallback. */
	function lastLoaded(iso: string | null | undefined): string {
		return freshnessRelative(iso, locale) ?? t.sources.neverLoaded;
	}
	/** Humanize a raw gap feed-token into a citizen sentence (localized lookup). */
	function humanizeGap(token: string): string {
		return t.gaps.tokens[token] ?? token.replace(/_/g, ' ');
	}
	/** detail/aggregate day-count as "14 days", or null → the honest-absence chip. */
	function fmtDays(v: number | null): string | null {
		return v == null ? null : `${v}${t.retention.daysUnit}`;
	}

	// The lane-label bundle the selector interpolates (i18n stays here).
	const laneLabels = $derived<LaneLabels>({
		laneLabel: (key) => t.lanes.laneLabel[key] ?? key,
		cadence: (key) => t.lanes.cadence[key] ?? '',
		gateVerdict: t.lanes.gateVerdict,
		maintenanceReason: t.lanes.maintenanceReason,
		maintenanceLabel: t.lanes.laneLabel.maintenance,
		maintenanceCadence: t.lanes.maintenanceCadence,
	});

	// ── Derived slices (null-safe off .data) ─────────────────────────────────────
	// The ToC + stat rail derive from these presence flags, so they stay in lock-step
	// with which sections actually render. The center column still gates each section
	// with the SAME flags — one source of truth for "is this section present".
	const prov = $derived(provenance.data ?? null);
	const dh = $derived(dataHealth.data ?? null);
	const freshness = $derived(prov ? freshnessOf(prov) : []);
	const sources = $derived(prov ? sourcesOf(prov) : []);
	const gaps = $derived(prov ? gapsOf(prov) : []);
	const retention = $derived(prov ? retentionOf(prov) : { detail: null, aggregate: null });
	const conformance = $derived(prov?.conformance ?? null);
	const pipelineNotes = $derived(
		prov ? pipelineNotesOf(prov, METHODOLOGY_METRIC_KEY, t.pipelineNotes.labels) : [],
	);
	const hasRetention = $derived(retention.detail != null || retention.aggregate != null);
	const laneRows = $derived(dh ? selectLaneRows(dh, laneLabels) : []);
	const envelope = $derived(
		prov
			? selectEnvelope(prov as Provenance, dh)
			: { generationId: null, schemaVersion: null, methodologyVersion: null },
	);
	const hasEnvelope = $derived(
		envelope.generationId != null ||
			envelope.schemaVersion != null ||
			envelope.methodologyVersion != null,
	);

	// ── Section presence registry (order = pipeline order; numbers frozen 1–8) ────
	// Each section carries its FIXED number (matching the SectionHeading chip) and a
	// presence flag; the ToC lists only present sections but keeps their own number,
	// so a stood-down section leaves a gap in the run rather than re-sequencing.
	const sectionDefs = $derived([
		{ id: 'health-lanes', number: 1, title: t.lanes.section, present: laneRows.length > 0 },
		{
			id: 'health-freshness',
			number: 2,
			title: t.freshness.section,
			present: freshness.length > 0,
		},
		{ id: 'health-sources', number: 3, title: t.sources.section, present: sources.length > 0 },
		{ id: 'health-gaps', number: 4, title: t.gaps.section, present: gaps.length > 0 },
		{
			id: 'health-pipeline-notes',
			number: 5,
			title: t.pipelineNotes.section,
			present: pipelineNotes.length > 0,
		},
		{ id: 'health-retention', number: 6, title: t.retention.section, present: hasRetention },
		{
			id: 'health-conformance',
			number: 7,
			title: t.conformance.section,
			present: conformance != null,
		},
		{ id: 'health-envelope', number: 8, title: t.envelope.section, present: hasEnvelope },
	]);

	const tocEntries = $derived.by((): TocEntry[] =>
		sectionDefs
			.filter((s) => s.present)
			.map((s) => ({
				id: s.id,
				title: s.title,
				level: 2,
				badge: { kind: 'number' as const, value: s.number },
				children: [],
			})),
	);

	const dailyGeneratedMeta = $derived(
		prov?.generated_utc
			? { text: formatUtc(prov.generated_utc, locale), datetime: prov.generated_utc }
			: null,
	);
	const liveGeneratedMeta = $derived(
		dh?.generated_utc
			? { text: formatUtc(dh.generated_utc, locale), datetime: dh.generated_utc }
			: null,
	);
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const entries: ArticleMetaEntry[] = [];
		if (
			dailyGeneratedMeta &&
			liveGeneratedMeta &&
			dailyGeneratedMeta.datetime !== liveGeneratedMeta.datetime
		) {
			entries.push(t.article.dailyAsOf, dailyGeneratedMeta, t.article.liveAsOf, liveGeneratedMeta);
		} else {
			const sharedGeneratedMeta = dailyGeneratedMeta ?? liveGeneratedMeta;
			if (sharedGeneratedMeta) entries.push(t.asOf, sharedGeneratedMeta);
		}
		if (tocEntries.length > 0) entries.push(t.article.sections(tocEntries.length));
		return entries;
	});
	// ── Right-rail stat summary (pass/fail, from data on the page) ────────────────
	// Applicable lanes only (the MAINTENANCE not-applicable row + gate-less lanes are
	// excluded from the pass count); a lane "passes" when its gate aspect is on_time.
	// The worst lane is the first non-passing applicable lane (pipeline order).
	const laneStat = $derived.by(() => {
		const applicable = laneRows.filter((r: LaneRow) => r.applicable && r.gate != null);
		const passing = applicable.filter((r) => r.gate?.aspect === 'on_time');
		const worst = applicable.find((r) => r.gate?.aspect !== 'on_time') ?? null;
		return { total: applicable.length, passing: passing.length, worst };
	});
	// Feeds "fresh" = freshness verdict resolves to the ok bucket.
	const feedStat = $derived.by(() => {
		const total = freshness.length;
		const ok = freshness.filter((f) => verdictFor(f.status).aspect === 'on_time').length;
		return { total, ok };
	});

	// ── Active-section tracking + ToC navigation ──────────────────────────────────
	// DetailShell owns the single IntersectionObserver and writes `activeId` back via
	// `bind:activeId`; this state receives it and feeds the left rail ToC (whose own
	// footer carries the ONE "SEC n/m" reading readout).
	let activeId = $state('');

	function navigate(id: string): void {
		document
			.querySelector(`[data-toc="${id}"]`)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<DetailShell
	class="health-detail"
	bind:activeId
	{tocEntries}
	onNavigate={navigate}
	tocOpenAria={t.toc.pill.open}
	tocCloseAria={t.toc.pill.close}
>
	{#snippet articleHeader()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={t.heading}
			tags={t.article.tags}
			tagsAria={t.article.tagsAria}
			backHref={localizeHref('/', locale)}
			backLabel={t.article.back}
			meta={articleMeta}
			titleId="status-title"
		/>
	{/snippet}

	{#snippet mobileSummary()}
		{@render statCards()}
	{/snippet}

	{#snippet left()}
		<div class="health-toc-rail">
			{#if tocEntries.length > 0}
				<TocNav
					entries={tocEntries}
					{activeId}
					onNavigate={navigate}
					heading={t.toc.label}
					counterPrefix={t.toc.counterPrefix}
					sectionKey="status-toc"
				/>
			{/if}
		</div>
	{/snippet}

	{#snippet right()}
		<aside class="health-stat-aside" aria-label={t.statRail.label}>
			{@render statCards()}
		</aside>
	{/snippet}

	{#snippet center()}
		<p class="health-lede">{t.lede}</p>
		<!-- The boundary owns the skeleton/error/empty UX for the daily provenance
			     document; the sections + ToC + stat rail derive from `provenance.data`
			     at script level (null-safe), so the resolved snippet arg is unused. -->
		<ResourceBoundary resource={provenance} lang={locale}>
			{#snippet children(_p)}
				<div class="health-sections" data-slot="health-sections">
					<!-- ── Aggregate lane-gate verdict (§C5.9) ────────────────────────
						     The page opens with ONE terminal verdict — "N of M lanes passing ·
						     worst: X" — before the detail ledger, so the reader gets the whole-
						     pipeline answer first. Present only when applicable lanes exist. -->
					{#if laneStat.total > 0}
						<div class="health-section health-aggregate" data-slot="health-aggregate">
							<TerminalPanel title={t.aggregate.title}>
								<p class="health-aggregate__verdict">
									<span class="health-aggregate__summary"
										>{t.aggregate.summary(String(laneStat.passing), String(laneStat.total))}</span
									>
									<span class="health-aggregate__worst">
										{#if laneStat.worst}{t.aggregate.worst(laneStat.worst.label)}{:else}{t.aggregate
												.allClear}{/if}
									</span>
								</p>
							</TerminalPanel>
						</div>
					{/if}

					<!-- ── Pipeline lanes (top section) ──────────────────────────── -->
					{#if laneRows.length > 0}
						<div class="health-section" data-toc="health-lanes">
							<SectionLanes rows={laneRows} copy={t} {locale} />
						</div>
					{/if}

					<!-- ── Per-feed freshness ─────────────────────────────────────── -->
					{#if freshness.length > 0}
						<div class="health-section" data-toc="health-freshness">
							<SectionFreshness items={freshness} {verdictFor} {humanizeAge} copy={t} />
						</div>
					{/if}

					<!-- ── Source-feed lineage ────────────────────────────────────── -->
					{#if sources.length > 0}
						<div class="health-section" data-toc="health-sources">
							<SectionSources items={sources} {lastLoaded} copy={t} />
						</div>
					{/if}

					<!-- ── Known data gaps (honesty banner) ───────────────────────── -->
					{#if gaps.length > 0}
						<div class="health-section" data-toc="health-gaps">
							<SectionGaps {gaps} {humanizeGap} copy={t} />
						</div>
					{/if}

					<!-- ── Pipeline notes ─────────────────────────────────────────── -->
					{#if pipelineNotes.length > 0}
						<div class="health-section" data-toc="health-pipeline-notes">
							<SectionNotes notes={pipelineNotes} copy={t} />
						</div>
					{/if}

					<!-- ── Retention ──────────────────────────────────────────────── -->
					{#if hasRetention}
						<div class="health-section" data-toc="health-retention">
							<SectionRetention
								detail={retention.detail}
								aggregate={retention.aggregate}
								{fmtDays}
								copy={t}
								{locale}
							/>
						</div>
					{/if}

					<!-- ── Conformance ────────────────────────────────────────────── -->
					{#if conformance}
						<div class="health-section" data-toc="health-conformance">
							<SectionConformance {conformance} copy={t} {locale} />
						</div>
					{/if}

					<!-- ── Build accountability (envelope) ────────────────────────── -->
					{#if hasEnvelope}
						<div class="health-section" data-toc="health-envelope">
							<SectionEnvelope {envelope} copy={t} {locale} />
						</div>
					{/if}
				</div>
			{/snippet}
		</ResourceBoundary>
	{/snippet}
</DetailShell>
<!-- The floating mobile ToC pill now lives INSIDE DetailShell (it owns the observer +
     the pill); no separate render + no 1024–1279 re-show hack is needed — the shell's
     rails appear at the SAME 1024 boundary the pill hides at. -->

<!-- Right-rail / mobile-summary stat cards — a compact pass/fail summary from the
     lanes gate + feed freshness. Rendered ONCE and dropped into both the desktop
     right rail and the mobile top strip. -->
{#snippet statCards()}
	<div class="health-stat-rail">
		{#if laneStat.total > 0}
			<div class="health-stat" data-slot="stat-lanes">
				<span class="health-stat__title">{t.statRail.lanes.title}</span>
				<p class="health-stat__count">
					{t.statRail.lanes.passing(String(laneStat.passing), String(laneStat.total))}
				</p>
				<p class="health-stat__sub">
					{#if laneStat.worst}{t.statRail.lanes.worst(laneStat.worst.label)}{:else}{t.statRail.lanes
							.allClear}{/if}
				</p>
			</div>
		{/if}
		{#if feedStat.total > 0}
			<div class="health-stat" data-slot="stat-feeds">
				<span class="health-stat__title">{t.statRail.feeds.title}</span>
				<p class="health-stat__count">
					{t.statRail.feeds.fresh(String(feedStat.ok), String(feedStat.total))}
				</p>
			</div>
		{/if}
	</div>
{/snippet}

<style>
	.health-lede {
		margin: 0 0 1.5rem;
		max-width: 60ch;
		font-size: var(--text-subheading);
		line-height: 1.65;
		color: var(--secondary-foreground);
	}

	/* ── Left rail (SEC readout + ToC) ─────────────────────────────────────────
	   DetailShell shows/hides the whole left rail at 1024 (the floating TocPill covers
	   below), so this only owns the in-rail stacking. */
	.health-toc-rail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	/* ── Center sections ───────────────────────────────────────────────────────
	   The existing 8 sections keep their own vertical rhythm; the wrappers only add
	   the ToC scroll anchor + inter-section spacing. */
	.health-sections {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
		min-width: 0;
		max-width: var(--container-content);
	}
	.health-section {
		min-width: 0;
	}

	/* Aggregate verdict panel — the pass-summary + worst-lane sentence inside the
	   terminal frame. Not a data mark / no --primary; the summary reads in the
	   heading voice, the worst clause in the muted mono voice. */
	.health-aggregate__verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem 0.75rem;
		margin: 0;
	}
	.health-aggregate__summary {
		font-family: var(--font-heading);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.health-aggregate__worst {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}

	/* ── Right rail / mobile summary stat cards ────────────────────────────────
	   Lanes-passing + feeds-fresh, from data on the page. Desktop: sticky right
	   rail. Mobile: reflowed into a wrapping top strip via mobileSummary. No data
	   marks / no --primary — the counts read in the calm mono/heading voice. */
	.health-stat-aside {
		min-width: 0;
	}
	.health-stat-rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
	}
	:global(.detail-shell-mobile-summary) .health-stat-rail {
		flex-direction: row;
		flex-wrap: wrap;
	}
	:global(.detail-shell-mobile-summary) .health-stat {
		flex: 1 1 10rem;
	}
	.health-stat {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--muted);
		min-width: 0;
	}
	.health-stat__title {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.health-stat__count {
		margin: 0;
		font-family: var(--font-heading);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.health-stat__sub {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
</style>
