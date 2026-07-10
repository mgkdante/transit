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
      to) 8 sections + a SEC n/m readout; CENTER = the 8 gated, single-title
      collapsible cards; RIGHT = per-feed stat cards (lanes
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
	import { onMount, tick } from 'svelte';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import {
		getProvenance,
		getDataHealth,
		freshnessRelative,
		type DataHealth,
		type Provenance,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { formatRelativeSeconds, formatUtc } from '$lib/utils/time';
	import { METHODOLOGY_METRIC_KEY } from '$lib/features/metrics/metrics.content';
	import { ArticleHeader, DetailShell, type ArticleMetaEntry } from '$lib/components/layout';
	import { ResourceBoundary } from '$lib/components/surface';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import {
		CollapsibleSection,
		TocNav,
		tocElement,
		settleLayout,
		type TocEntry,
	} from '$lib/components/shared';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import { persisted } from '$lib/stores';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
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

	function provenanceIsEmpty(value: Provenance): boolean {
		const windows = retentionOf(value);
		return (
			freshnessOf(value).length === 0 &&
			sourcesOf(value).length === 0 &&
			gapsOf(value).length === 0 &&
			pipelineNotesOf(value, METHODOLOGY_METRIC_KEY, t.pipelineNotes.labels).length === 0 &&
			windows.detail == null &&
			windows.aggregate == null &&
			value.conformance == null &&
			value.publish_generation_id == null &&
			value.schema_version == null &&
			value.methodology_version == null
		);
	}

	function dataHealthIsEmpty(value: DataHealth): boolean {
		return (value.lanes?.length ?? 0) === 0 && (value.feeds?.length ?? 0) === 0;
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
	// Each section carries its FIXED number (matching the parent card badge) and a
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
			entries.push(
				{ ...dailyGeneratedMeta, label: t.article.dailyAsOf },
				{ ...liveGeneratedMeta, label: t.article.liveAsOf },
			);
		} else {
			const sharedGeneratedMeta = dailyGeneratedMeta ?? liveGeneratedMeta;
			if (sharedGeneratedMeta) entries.push({ ...sharedGeneratedMeta, label: t.asOf });
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
	const railOpen = {
		lanes: persisted('status-rail-lanes', true),
		feeds: persisted('status-rail-feeds', true),
	};

	function setRailOpen(key: keyof typeof railOpen, next: boolean): void {
		railOpen[key].value = next;
	}

	// ── Active-section tracking + ToC navigation ──────────────────────────────────
	// DetailShell owns the single IntersectionObserver and writes `activeId` back via
	// `bind:activeId`; this state receives it and feeds the left rail ToC (whose own
	// footer carries the ONE "SEC n/m" reading readout).
	let activeId = $state('');
	let cardOpenSignals = $state<Record<string, number>>({});
	const cardOpenSignal = (id: string): number => cardOpenSignals[id] ?? 0;

	function openCard(id: string): void {
		cardOpenSignals = { ...cardOpenSignals, [id]: cardOpenSignal(id) + 1 };
	}

	const openableAnchors = $derived(new Set(tocEntries.map((entry) => entry.id)));
	let pendingHash = $state<string | null>(null);
	let consumingHash = false;
	let requestedHash: string | null = null;
	let navigationGeneration = 0;

	function decodedHash(): string | null {
		const raw = window.location.hash.replace(/^#/, '');
		if (!raw) return null;
		try {
			return decodeURIComponent(raw);
		} catch {
			return null;
		}
	}

	function queueHash(id: string | null): void {
		if (id === requestedHash) return;
		requestedHash = id;
		navigationGeneration += 1;
		pendingHash = id;
	}

	async function reveal(id: string, generation = ++navigationGeneration): Promise<boolean> {
		if (!openableAnchors.has(id)) return false;
		openCard(id);
		await tick();
		const target = tocElement(id);
		// The disclosure expand (and, under a remembered collapse, every sibling's
		// fold) animates the page height; scroll clamping uses call-time geometry,
		// so let the layout settle before positioning (design: open the
		// destination BEFORE final positioning).
		await settleLayout(target);
		if (generation !== navigationGeneration) return false;
		target?.scrollIntoView({
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
			block: 'start',
		});
		return true;
	}

	async function consumePendingHash(): Promise<void> {
		const id = pendingHash;
		if (consumingHash || !id || !openableAnchors.has(id)) return;
		consumingHash = true;
		try {
			await tick();
			if (pendingHash !== id || !openableAnchors.has(id)) return;
			if ((await reveal(id, navigationGeneration)) && pendingHash === id) pendingHash = null;
		} finally {
			consumingHash = false;
			if (pendingHash && pendingHash !== id && openableAnchors.has(pendingHash)) {
				void consumePendingHash();
			}
		}
	}

	$effect(() => {
		const signature = tocEntries.map((entry) => entry.id).join('|');
		const id = pendingHash;
		void signature;
		void id;
		void consumePendingHash();
	});

	onMount(() => {
		let cancelled = false;
		void (async () => {
			await tick();
			if (!cancelled) queueHash(decodedHash());
		})();
		const onHashChange = () => {
			queueHash(decodedHash());
		};
		window.addEventListener('hashchange', onHashChange);
		return () => {
			cancelled = true;
			navigationGeneration += 1;
			window.removeEventListener('hashchange', onHashChange);
		};
	});

	async function navigate(id: string): Promise<void> {
		await reveal(id);
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
			metaPending={provenance.loading || dataHealth.loading}
			titleId="status-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
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
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal}
					bulkCollapsed={quietModeStore.enabled}
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
		<div class="health-sections" data-slot="health-sections">
			<CollapsibleSection
				title={t.overview.title}
				sectionKey="status-overview"
				open={true}
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			>
				<div class="health-overview">
					<p class="health-lede">{t.lede}</p>
					{#if !prov || provenanceIsEmpty(prov)}
						<div class="health-resource-state" aria-label={t.overview.dailyRecord}>
							<SectionLabel text={t.overview.dailyRecord} variant="metric" />
							<ResourceBoundary resource={provenance} lang={locale} isEmpty={provenanceIsEmpty}>
								{#snippet children(_value)}{/snippet}
							</ResourceBoundary>
						</div>
					{/if}
					{#if !dh || dataHealthIsEmpty(dh)}
						<div class="health-resource-state" aria-label={t.overview.liveFeeds}>
							<SectionLabel text={t.overview.liveFeeds} variant="metric" />
							<ResourceBoundary resource={dataHealth} lang={locale} isEmpty={dataHealthIsEmpty}>
								{#snippet children(_value)}{/snippet}
							</ResourceBoundary>
						</div>
					{:else if laneStat.total > 0}
						<div class="health-aggregate" data-slot="health-aggregate">
							<TerminalPanel title={t.aggregate.title}>
								<p class="health-aggregate__verdict">
									<span class="health-aggregate__summary">
										{t.aggregate.summary(String(laneStat.passing), String(laneStat.total))}
									</span>
									<span class="health-aggregate__worst">
										{#if laneStat.worst}
											{t.aggregate.worst(laneStat.worst.label)}
										{:else}
											{t.aggregate.allClear}
										{/if}
									</span>
								</p>
							</TerminalPanel>
						</div>
					{/if}
				</div>
			</CollapsibleSection>

			<!-- ── Pipeline lanes (top section) ──────────────────────────── -->
			{#if laneRows.length > 0}
				<CollapsibleSection
					title={t.lanes.section}
					index={0}
					anchor="health-lanes"
					sectionKey="status-card-health-lanes"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-lanes')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionLanes rows={laneRows} copy={t} {locale} />
				</CollapsibleSection>
			{/if}

			<!-- ── Per-feed freshness ─────────────────────────────────────── -->
			{#if freshness.length > 0}
				<CollapsibleSection
					title={t.freshness.section}
					index={1}
					anchor="health-freshness"
					sectionKey="status-card-health-freshness"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-freshness')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionFreshness items={freshness} {verdictFor} {humanizeAge} copy={t} />
				</CollapsibleSection>
			{/if}

			<!-- ── Source-feed lineage ────────────────────────────────────── -->
			{#if sources.length > 0}
				<CollapsibleSection
					title={t.sources.section}
					index={2}
					anchor="health-sources"
					sectionKey="status-card-health-sources"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-sources')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionSources items={sources} {lastLoaded} copy={t} />
				</CollapsibleSection>
			{/if}

			<!-- ── Known data gaps (honesty banner) ───────────────────────── -->
			{#if gaps.length > 0}
				<CollapsibleSection
					title={t.gaps.section}
					index={3}
					anchor="health-gaps"
					sectionKey="status-card-health-gaps"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-gaps')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionGaps {gaps} {humanizeGap} copy={t} />
				</CollapsibleSection>
			{/if}

			<!-- ── Pipeline notes ─────────────────────────────────────────── -->
			{#if pipelineNotes.length > 0}
				<CollapsibleSection
					title={t.pipelineNotes.section}
					index={4}
					anchor="health-pipeline-notes"
					sectionKey="status-card-health-pipeline-notes"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-pipeline-notes')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionNotes notes={pipelineNotes} copy={t} />
				</CollapsibleSection>
			{/if}

			<!-- ── Retention ──────────────────────────────────────────────── -->
			{#if hasRetention}
				<CollapsibleSection
					title={t.retention.section}
					index={5}
					anchor="health-retention"
					sectionKey="status-card-health-retention"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-retention')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionRetention
						detail={retention.detail}
						aggregate={retention.aggregate}
						{fmtDays}
						copy={t}
						{locale}
					/>
				</CollapsibleSection>
			{/if}

			<!-- ── Conformance ────────────────────────────────────────────── -->
			{#if conformance}
				<CollapsibleSection
					title={t.conformance.section}
					index={6}
					anchor="health-conformance"
					sectionKey="status-card-health-conformance"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-conformance')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionConformance
						{conformance}
						copy={t}
						{locale}
						closeSignal={quietModeStore.closeSignal}
						openSignal={quietModeStore.openSignal}
						bulkCollapsed={quietModeStore.enabled}
					/>
				</CollapsibleSection>
			{/if}

			<!-- ── Build accountability (envelope) ────────────────────────── -->
			{#if hasEnvelope}
				<CollapsibleSection
					title={t.envelope.section}
					index={7}
					anchor="health-envelope"
					sectionKey="status-card-health-envelope"
					open={true}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal + cardOpenSignal('health-envelope')}
					bulkCollapsed={quietModeStore.enabled}
				>
					<SectionEnvelope {envelope} copy={t} {locale} />
				</CollapsibleSection>
			{/if}
		</div>
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
			<CollapsibleSection
				title={t.statRail.lanes.title}
				bind:open={() => railOpen.lanes.value, (next) => setRailOpen('lanes', next)}
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			>
				<div class="health-stat__body" data-slot="stat-lanes">
					<p class="health-stat__count">
						{t.statRail.lanes.passing(String(laneStat.passing), String(laneStat.total))}
					</p>
					<p class="health-stat__sub">
						{#if laneStat.worst}
							{t.statRail.lanes.worst(laneStat.worst.label)}
						{:else}
							{t.statRail.lanes.allClear}
						{/if}
					</p>
				</div>
			</CollapsibleSection>
		{/if}
		{#if feedStat.total > 0}
			<CollapsibleSection
				title={t.statRail.feeds.title}
				bind:open={() => railOpen.feeds.value, (next) => setRailOpen('feeds', next)}
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			>
				<div class="health-stat__body" data-slot="stat-feeds">
					<p class="health-stat__count">
						{t.statRail.feeds.fresh(String(feedStat.ok), String(feedStat.total))}
					</p>
				</div>
			</CollapsibleSection>
		{/if}
	</div>
{/snippet}

<style>
	.health-overview {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}
	.health-lede {
		margin: 0;
		max-width: 60ch;
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
		color: var(--secondary-foreground);
	}
	.health-resource-state {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.health-aggregate {
		min-width: 0;
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
	   The eight parent cards keep the existing body presenters in pipeline order;
	   this column owns only their inter-card spacing. */
	.health-sections {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
		min-width: 0;
		max-width: var(--container-content);
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
		align-items: flex-start;
	}
	:global(.detail-shell-mobile-summary) .health-stat-rail :global([data-slot='card']) {
		flex: 1 1 10rem;
	}
	.health-stat__body {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
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
		font-size: 0.95rem;
		line-height: 1.45;
		color: var(--muted-foreground);
	}

	@media (min-width: 1024px) {
		.health-lede {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
</style>
