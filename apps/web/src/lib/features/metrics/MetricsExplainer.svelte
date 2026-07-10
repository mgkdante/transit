<!--
  MetricsExplainer: the /metrics surface screen (slice-9.6).

  The in-app metric explainer. For every citizen-facing reliability metric it
  renders, grouped by the five reliability clusters: a definition, the math, the
  verbatim Defining SQL, a "what it's NOT" misread warning, and the honest
  caveats, all bilingual (FR canonical). A (i) tip on the reliability surface
  deep-links here at each metric's anchor.

  SHELL: a MEASURED ARTICLE mounted on the shared `layout/DetailShell` (P5.4c) — the
  ONE detail-page system that ports the yesid.dev blog/project detail architecture and
  that /status shares. This feature supplies only the CONTENT of each DetailShell slot;
  the shell owns the layout + ToC wiring:

	    · HEADER → the shared ArticleHeader COVER (P5-R R3a.2: the yesid blog/project
	      magazine-cover port, 1:1 — circuit grid + ManifestoCanvas + watermark +
	      category rule + keyword-highlighted title + tag pills + meta row; flush to
	      the viewport top). The exact two article controls ride its controls row;
      DetailShell adds the closing hazard tape. The lede leads the body column.
    · The shell's 3-column body grid is `1fr 2fr 1fr` at ≥1024 (gap 2rem), collapsing to
      a single column below. LEFT slot = the numbered TocNav + the SEC n/m reading-position
      readout; CENTER = the provenance preamble + the per-metric cards; RIGHT = the
      Provenance / Coverage / Freshness stat cards (reflowed to a mobileSummary strip < 1024).
    · The LEFT rail's ToC carries its OWN user-driven collapse (its chevron, persisted via
      sectionKey="metrics-toc") AND follows FOCUS (yesid Quiet-Mode parity) — FOCUS ON
      folds it, FOCUS OFF reopens it; the reader's manual chevron still wins between
      signals.
    · The provenance preamble + one CollapsibleSection card PER METRIC (number badge,
      `data-toc` anchor, deep-link `id` on the section block) carry the definition / math /
      SQL / "what it's NOT" / caveats. P5-R R3 (operator 2026-07-10): every card is
      DEFAULT-OPEN (the yesid article contract; the S10 default-closed deviation is
      retired) with its own persisted open-state (sectionKey `metrics-card-<anchor>`);
      FOCUS collapses everything, unfocus reopens everything; a mount/hashchange opener +
      ToC navigation still open a specific target card under FOCUS.
    · MOBILE (< 1024): DetailShell renders the shared TocPill floating pill + drawer, driven
      by the SAME activeId (which the shell owns via one observeActiveToc — no duplicate
      observer here; this feature binds `activeId` back from the shell) + this feature's
      open-then-scroll `navigate`.

  Composes: DetailShell (hazard tape + 3-col grid + observer + pill) + ArticleHeader
  (cover) + SectionLabel + the shared CodeBlock (SQL syntax chrome) + the
  shared shared/ TOC + collapsible-card kit (CollapsibleSection / TocNav / toc.ts). The
  co-located metrics/+layout.svelte is a bare pass-through.

  DOCTRINE: no data marks here (prose + SQL), so the dataviz scale is not in play;
  --primary appears only on interactive chrome (the TOC, the pill, the back-to-top
  link, the section-card accent). Honest framing is the whole point: the
  provenance preamble + per-metric caveats carry the "proxy, not certified OTP /
  no AVL / NULL-not-0" doctrine verbatim. AA via --muted-foreground; reduced-motion
  guarded (the shared CollapsibleSection + TocPill own their reduced-motion gates,
  and the only motion here is scroll, dropped under prefers-reduced-motion).
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { getProvenance } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ConformanceBadge, FreshnessStamp } from '$lib/components/surface';
	import { ArticleHeader, DetailShell } from '$lib/components/layout';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { persisted } from '$lib/stores';
	import { formatUtc } from '$lib/utils/time';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import {
		CollapsibleSection,
		SectionIcon,
		TocNav,
		tocElement,
		settleLayout,
		type TocEntry,
	} from '$lib/components/shared';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import {
		METRICS,
		METRIC_CLUSTER_ORDER,
		methodologyNoteFor,
		type MetricEntry,
	} from './metrics.content';
	import { metricsCopy } from './metrics.copy';
	import EasterProse from './EasterProse.svelte';

	const locale: Locale = getLocale();
	const t = $derived(metricsCopy[locale]);

	// Stable, locale-free anchor for the structural-gaps ("Lacunes") card. It is a
	// non-metric section, so it carries an icon badge (not the continuous metric
	// number) and sits after the metric clusters; the same anchor is its element id,
	// its data-toc hook, and its ToC entry id.
	const LACUNES_ANCHOR = 'structural-gaps';

	// Stable, locale-free anchor for the live-positions explainer card. The on-map
	// "How this works" link (MapMotionControl) deep-links to /metrics#live-positions,
	// so this id is load-bearing and must not change. It is a non-metric section, so
	// it carries an icon badge (not the continuous metric number) and sits just
	// before the structural-gaps close.
	const LIVE_POSITIONS_ANCHOR = 'live-positions';

	// Honesty layer — the active provider's feed-conformance verdict. Supplementary
	// (the badge renders nothing when conformance is null / the fetch fails), so it
	// never blocks the static methodology article.
	const provenance = createResource(() => getProvenance());

	// Article-cover data (P5-R R3a.2) — REAL data only; a missing datum drops its
	// meta entry, never fabricated. The generated stamp comes from the
	// supplementary provenance document.
	const generatedMeta = $derived(
		provenance.data?.generated_utc != null
			? {
					text: formatUtc(provenance.data.generated_utc, locale),
					datetime: provenance.data.generated_utc,
				}
			: null,
	);
	// The supplementary provenance fetch errored (or settled with nothing), so the
	// live conformance badge cannot render. The static methodology + the structural-
	// gaps card always render regardless; this only swaps the live badge for an
	// honest, localized "verdict unavailable" stand-down line (never a blank gap, never
	// a thrown error). Only after the resource has settled, so it never flashes mid-load.
	const provenanceUnavailable = $derived(
		provenance.settled && !provenance.data?.conformance && provenance.error != null,
	);

	// "How we measure" doctrine constants, read DYNAMICALLY from the published
	// provenance.methodology (min_n_rate / wilson_z are machine-readable numbers the
	// pipeline serves — provenance.py). We render the SERVED values verbatim, never a
	// hardcoded 30 / 1.96, so the page can never drift from the run. methodology is
	// typed Record<string, unknown> (schema keeps it open), so we coerce each value to
	// a finite number and fall back to honest-absence copy when either is missing (the
	// resource is supplementary — a failed/empty fetch simply yields no constants line).
	const methodologyNumber = (key: string): number | null => {
		const raw = provenance.data?.methodology?.[key];
		return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
	};
	const doctrineConstants = $derived.by(() => {
		const minN = methodologyNumber('min_n_rate');
		const wilsonZ = methodologyNumber('wilson_z');
		if (minN == null || wilsonZ == null) return null;
		// Number → string via the active locale so decimals read naturally (1,96 fr / 1.96 en).
		return {
			minN: minN.toLocaleString(locale),
			wilsonZ: wilsonZ.toLocaleString(locale),
		};
	});

	// Group entries by cluster, preserving the canonical surface cluster order and
	// the in-array metric order within each cluster. Empty clusters are dropped.
	const groups = $derived(
		METRIC_CLUSTER_ORDER.map((cluster) => ({
			cluster,
			label: t.clusters[cluster],
			entries: METRICS.filter((m) => m.cluster === cluster),
		})).filter((g) => g.entries.length > 0),
	);

	// The metrics in render order (cluster order, then in-array order). The number
	// badge is the 1-based position in THIS flat list, so the rail's "01 / 02 / …"
	// reads continuously down the page (same as the yesid blog TOC numbering),
	// while the cluster overlines on the cards keep the five-cluster grouping.
	const orderedMetrics = $derived(groups.flatMap((g) => g.entries));

	// Dot-separated meta row: generated date · metric count · family count (the
	// yesid date · read-time · language grammar, on this article's real numbers).
	const articleMeta = $derived(
		[
			generatedMeta,
			`${orderedMetrics.length} ${t.statRail.coverage.metrics}`,
			`${groups.length} ${t.statRail.coverage.families}`,
		].filter((x) => x != null),
	);
	const confidenceMeaning = $derived(
		(entry: MetricEntry) => t.confidence.levels[entry.confidence].chip,
	);

	// Live pipeline note — the verbatim provenance.methodology string for THIS
	// metric from the latest build, when one is mapped + present. Rendered as-is
	// (a published string), set apart from the static science. Null/absent
	// methodology → no note (the card is unchanged). Re-derives as the supplementary
	// provenance resource settles; the resource is supplementary, so a failed/empty
	// fetch simply yields no note.
	const methodologyNote = $derived((entry: MetricEntry): string | null =>
		methodologyNoteFor(entry.key, provenance.data?.methodology),
	);

	// ── Shared TOC model (consumed by both the desktop rail + the mobile pill) ──
	// One numbered entry per metric, in render order. badge = the 1-based index in
	// orderedMetrics; id = the metric anchor (the SAME anchor the (i) tip deep-links
	// to and the section card carries as data-toc + the section block's element id).
	// Stable, locale-free anchor for the provenance preamble. It renders FIRST and
	// is a non-metric section, so it leads the ToC with an icon badge (not the
	// metric number run); the same anchor is its data-toc hook + ToC entry id.
	const PROVENANCE_ANCHOR = 'metrics-provenance';

	const tocEntries = $derived.by((): TocEntry[] => [
		// The provenance preamble opens the page — a non-metric section, so it
		// carries an icon mark (not the metric number run), keeping the TOC entry in
		// lock-step with its leading position above every metric card.
		{
			id: PROVENANCE_ANCHOR,
			title: t.provenance.label,
			level: 2,
			badge: { kind: 'icon' as const, name: 'layers' },
			children: [],
		},
		...orderedMetrics.map((entry, i) => ({
			id: entry.anchor,
			title: entry.name[locale],
			level: 2,
			badge: { kind: 'number' as const, value: i + 1 },
			children: [],
		})),
		// The live-positions explainer — a non-metric section (the on-map "How this
		// works" link deep-links here), carrying the same 'chart' icon mark its card
		// shows so the TOC entry and the card badge stay in lock-step.
		{
			id: LIVE_POSITIONS_ANCHOR,
			title: t.livePositions.title,
			level: 2,
			badge: { kind: 'icon' as const, name: 'chart' },
			children: [],
		},
		// The structural-gaps card closes the page — a non-metric section, so it
		// carries the same 'eye' icon mark its card shows (not the metric number run),
		// keeping the TOC entry and the card badge in lock-step.
		{
			id: LACUNES_ANCHOR,
			title: t.lacunes.title,
			level: 2,
			badge: { kind: 'icon' as const, name: 'eye' },
			children: [],
		},
	]);

	// ── Quiet / FOCUS mode (focus reading) ─────────────────────────────────────
	// P5-R R3 (operator ruling 2026-07-10): FOCUS is the yesid article contract,
	// SITE-WIDE — the page is DEFAULT-OPEN (everything readable on arrival), FOCUS
	// collapses to a ToC-led reading mode, and unfocus reopens EVERYTHING (cards +
	// ToC — the openSignal-opens-ALL contract; the S10 default-closed deviation is
	// retired). The state, its signals, and the ONE localStorage preference
	// ('transit:quiet-mode') live in the shared quietModeStore; the FOCUS switch +
	// REMEMBER pin render via the shared QuietModeButton in the Masthead meta row.
	// This page only wires the shared store's signals into its cards + ToC. The
	// exact two controls render via QuietModeButton; there is no page-only third
	// bulk control.
	const cardCloseSignal = $derived(quietModeStore.closeSignal);

	// Per-card persisted-open key. Each metric/lacunes/live-positions card owns its
	// own sessionStorage-backed open state under this stable, locale-free key, so
	// the default is CLOSED (persisted() seeds from the `open` prop = false) and a
	// reader's choice survives a same-tab locale switch. Distinct from the ToC's own
	// `metrics-toc` key.
	const cardKey = (anchor: string): string => `metrics-card-${anchor}`;

	// Per-card "open THIS card" signal counters (yesid openSignal idiom, one per
	// anchor). The mount/hashchange opener + ToC navigation bump the target's counter;
	// CollapsibleSection's edge-triggered openSignal effect opens exactly that card
	// (and, via setOpen, writes its persisted key). A plain object is fine — the keys
	// are a fixed set and each value is read reactively through cardOpenSignal().
	let cardOpenSignals = $state<Record<string, number>>({});
	const cardOpenSignal = (anchor: string): number =>
		(cardOpenSignals[anchor] ?? 0) + quietModeStore.openSignal;

	// The responsive right rail is mounted twice (desktop + mobile summary), but
	// each logical card has exactly one page-owned persisted state rune.
	const railOpen = {
		provenance: persisted('metrics-rail-provenance', true),
		coverage: persisted('metrics-rail-coverage', true),
		freshness: persisted('metrics-rail-freshness', true),
	};

	function setRailOpen(key: keyof typeof railOpen, next: boolean): void {
		railOpen[key].value = next;
	}

	// Open a specific card by anchor by bumping its open-signal (the same mechanism
	// FOCUS uses to CLOSE cards, in reverse). Used by the mount + hashchange opener
	// and by ToC navigation, so a closed target is opened before we scroll to it.
	function openCard(anchor: string): void {
		cardOpenSignals = { ...cardOpenSignals, [anchor]: (cardOpenSignals[anchor] ?? 0) + 1 };
	}

	// The set of anchors that correspond to a COLLAPSIBLE CARD (every metric card
	// + the opening provenance + live-positions + structural-gaps cards).
	const openableAnchors = $derived(
		new Set<string>([
			PROVENANCE_ANCHOR,
			...orderedMetrics.map((m) => m.anchor),
			LIVE_POSITIONS_ANCHOR,
			LACUNES_ANCHOR,
		]),
	);

	// ── Hash opener (mount + hashchange) ───────────────────────────────────────
	// A deep-link to /metrics#<anchor> (an (i) MetricInfo tip, an on-map "How this
	// works" link, a shared URL) must REVEAL its target on a default-closed page. If
	// the hash names a collapsible card, open ONLY that card, then position it
	// explicitly via navigate(): the native anchor jump fires against the
	// pre-hydration layout, and a remembered collapse reshapes the page after it,
	// leaving the native landing clamped past the target (design: open the
	// destination BEFORE final positioning). Runs once on mount (for the initial
	// hash) and on every hashchange (same-page (i) navigation swaps the hash
	// without a remount).
	let requestedHash: string | null = null;
	let navigationGeneration = 0;

	function openFromHash(): void {
		const raw = window.location.hash.replace(/^#/, '');
		let anchor: string | null = null;
		// A malformed fragment ('#%' etc.) must not throw during mount — the anchors
		// are plain ASCII, so an undecodable hash simply cannot match (S10 review F2).
		if (raw) {
			try {
				anchor = decodeURIComponent(raw);
			} catch {
				anchor = null;
			}
		}
		if (anchor === requestedHash) return;
		requestedHash = anchor;
		const generation = ++navigationGeneration;
		if (anchor && openableAnchors.has(anchor)) void navigate(anchor, generation);
	}

	onMount(() => {
		// Deep-link precedence over a restored pinned FOCUS is made DETERMINISTIC by
		// flushing the restore's closeSignal first (tick), then bumping the target
		// card's open signal as a separate edge (S10 review F3) — never relying on
		// the definition order of the two CollapsibleSection effects. The resulting
		// state (FOCUS reads ON, one deep-linked card open) matches the yesid quiet
		// contract: quiet folds cards but never locks them against explicit intent.
		let cancelled = false;
		void (async () => {
			await tick();
			if (!cancelled) openFromHash();
		})();
		window.addEventListener('hashchange', openFromHash);
		return () => {
			cancelled = true;
			navigationGeneration += 1;
			window.removeEventListener('hashchange', openFromHash);
		};
	});

	// ── Active-section tracking ────────────────────────────────────────────────
	// DetailShell owns the single IntersectionObserver (observeActiveToc) and writes
	// `activeId` back via `bind:activeId`; this state receives it and feeds the left
	// rail's TocNav + reading-position readout below (no duplicate observer here).
	let activeId = $state('');

	// ── TOC navigation ──────────────────────────────────────────────────────────
	// A TOC click OPENS its target card (default-closed page: a jump must reveal, not
	// land on a shut card), then scrolls to it. Opening a card while its siblings
	// stay closed does not disturb the scroll — every card is force-mounted, so the
	// closed siblings above keep their (collapsed) height and the target lands true.
	// The provenance preamble is not a card, so it just scrolls. await tick() flushes
	// the reactive open; settleLayout then waits out the 300ms height animation
	// (the expand, plus every sibling's fold under a remembered collapse) because
	// scroll clamping uses call-time geometry. Reduced-motion drops the smooth
	// scroll and its transitions, so the settle is two frames there.
	async function navigate(id: string, generation = ++navigationGeneration): Promise<void> {
		if (openableAnchors.has(id)) openCard(id);
		await tick();
		const target = tocElement(id);
		await settleLayout(target);
		if (generation !== navigationGeneration) return;
		target?.scrollIntoView({
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
			block: 'start',
		});
	}
</script>

<!-- The right-rail / mobile-summary stat cards — Provenance / Coverage / Freshness,
     all built from data the page already has. The snippet mounts in both responsive
     locations while each logical card binds to one page-owned persisted rune. -->
{#snippet statCards()}
	<div class="metrics-stat-rail">
		<!-- Provenance: the live feed-conformance verdict (the same honesty signal
		     the preamble carries), or an honest stand-down when it can't load. An
		     unresolved resource renders no empty disclosure shell. -->
		{#if provenance.data?.conformance || provenanceUnavailable}
			<CollapsibleSection
				title={t.statRail.provenance.title}
				bind:open={() => railOpen.provenance.value, (next) => setRailOpen('provenance', next)}
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			>
				<div class="metrics-stat__body" data-slot="stat-provenance">
					{#if provenance.data?.conformance}
						<ConformanceBadge conformance={provenance.data.conformance} {locale} />
					{:else}
						<p class="metrics-stat__note" role="status">{t.statRail.provenance.unavailable}</p>
					{/if}
				</div>
			</CollapsibleSection>
		{/if}

		<!-- Coverage: the shape of the page — how many metrics across how many
		     families, plus the confidence legend chips. Pure static counts. -->
		<CollapsibleSection
			title={t.statRail.coverage.title}
			bind:open={() => railOpen.coverage.value, (next) => setRailOpen('coverage', next)}
			closeSignal={quietModeStore.closeSignal}
			openSignal={quietModeStore.openSignal}
			bulkCollapsed={quietModeStore.enabled}
		>
			<div class="metrics-stat__body" data-slot="stat-coverage">
				<p class="metrics-stat__count">
					<span class="metrics-stat__big">{orderedMetrics.length}</span>
					<span class="metrics-stat__unit">{t.statRail.coverage.metrics}</span>
				</p>
				<p class="metrics-stat__sub">
					{groups.length}
					{t.statRail.coverage.families}
				</p>
				<ul class="metrics-stat__chips">
					{#each Object.entries(t.confidence.levels) as [level, info] (level)}
						<li><span class="metrics-chip">{info.chip}</span></li>
					{/each}
				</ul>
			</div>
		</CollapsibleSection>

		<!-- Freshness: when this methodology build's provenance document was generated
		     (the calm "Updated N ago" stamp — never a live-tier LIVE chip). -->
		{#if provenance.data?.generated_utc}
			<CollapsibleSection
				title={t.statRail.freshness.title}
				bind:open={() => railOpen.freshness.value, (next) => setRailOpen('freshness', next)}
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			>
				<div class="metrics-stat__body" data-slot="stat-freshness">
					<FreshnessStamp variant="updated" generatedUtc={provenance.data.generated_utc} {locale} />
				</div>
			</CollapsibleSection>
		{/if}
	</div>
{/snippet}

<DetailShell
	class="metrics-detail"
	bind:activeId
	{tocEntries}
	onNavigate={navigate}
	tocOpenAria={t.tocPill.open}
	tocCloseAria={t.tocPill.close}
>
	<!-- The ARTICLE COVER (P5-R R3a.2): the yesid magazine-cover header, 1:1 —
		     grid + circuit canvas + watermark + category rule + keyword-highlighted
		     title + tag pills + meta row; the exact two controls ride the
		     controls row. The cover owns its own band (nav-clearance mechanics
		     included), so DetailShell renders it in place of the default band. -->
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
			titleId="metrics-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	<!-- Mobile top summary strip — the right-rail stats reflowed above the sections
		     (DetailShell hides this ≥1024, where the right rail carries them). -->
	{#snippet mobileSummary()}
		{@render statCards()}
	{/snippet}

	<!-- LEFT rail: the numbered ToC (its footer carries the ONE SEC n / m readout). -->
	{#snippet left()}
		<div class="metrics-toc-rail">
			<!-- The ToC keeps its OWN user-driven collapse (its chevron) + persists
				     the choice across same-tab visits via `sectionKey`. S10 (2026-07-02):
				     it ALSO follows FOCUS now (yesid Quiet-Mode parity) — `closeSignal`
				     folds the rail on FOCUS ON, `openSignal` reopens it on FOCUS OFF. The
				     reader's manual chevron still works and still wins between signals. -->
			<TocNav
				entries={tocEntries}
				{activeId}
				onNavigate={navigate}
				heading={t.tocLabel}
				counterPrefix={t.tocCounterPrefix}
				sectionKey="metrics-toc"
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			/>
		</div>
	{/snippet}

	<!-- RIGHT rail: the three stat cards (desktop-sticky; reflowed to the top on
		     mobile via mobileSummary above). -->
	{#snippet right()}
		<aside class="metrics-stat-aside" aria-label={t.statRail.label}>
			{@render statCards()}
		</aside>
	{/snippet}

	{#snippet center()}
		<div class="sections-column" data-testid="metrics-sections">
			<!-- The opening Method + provenance card contains the lede and every
			     cross-cutting convention inherited by the metric cards below. -->
			<div class="section-block" id={PROVENANCE_ANCHOR}>
				<CollapsibleSection
					title={t.provenance.label}
					anchor={PROVENANCE_ANCHOR}
					sectionKey={cardKey(PROVENANCE_ANCHOR)}
					open={true}
					closeSignal={cardCloseSignal}
					openSignal={cardOpenSignal(PROVENANCE_ANCHOR)}
					bulkCollapsed={quietModeStore.enabled}
				>
					{#snippet icon()}
						<SectionIcon name="layers" class="h-4 w-4 shrink-0 text-primary" />
					{/snippet}
					<div class="metrics-article-prose">
						<p class="metrics-lede">{t.lede}</p>
						<p class="metrics-preamble">{t.provenance.body}</p>
						{#if provenance.data?.conformance}
							<div class="metrics-conformance">
								<ConformanceBadge conformance={provenance.data.conformance} {locale} />
							</div>
						{:else if provenanceUnavailable}
							<!-- Supplementary provenance failed to load: degrade honestly with a
							     localized stand-down line instead of a silent gap. The static
							     methodology + structural-gaps card below are unaffected. -->
							<p class="metrics-provenance-down" role="status">{t.provenance.unavailable}</p>
						{/if}

						<!-- How we measure: the cross-cutting conventions every metric inherits
						     (S10). Two static notes (capture-day vs service-day time model; the
						     2026-07-01 half-away rounding rebaseline) + a doctrine-constants line
						     rendered from the live provenance.methodology (min_n_rate / wilson_z),
						     with an honest-absence stand-down when that document has not loaded. -->
						<div class="metrics-measure">
							<SectionLabel text={t.provenance.howWeMeasure.label} variant="metric" />
							<div class="metrics-measure__item">
								<h3 class="metrics-measure__heading">
									{t.provenance.howWeMeasure.serviceDay.heading}
								</h3>
								<p class="metric__prose">{t.provenance.howWeMeasure.serviceDay.body}</p>
							</div>
							<div class="metrics-measure__item">
								<h3 class="metrics-measure__heading">
									{t.provenance.howWeMeasure.rounding.heading}
								</h3>
								<p class="metric__prose">{t.provenance.howWeMeasure.rounding.body}</p>
							</div>
							<div class="metrics-measure__item">
								<h3 class="metrics-measure__heading">
									{t.provenance.howWeMeasure.constants.heading}
								</h3>
								{#if doctrineConstants}
									<p class="metric__prose" data-testid="metrics-doctrine-constants">
										{t.provenance.howWeMeasure.constants.body(
											doctrineConstants.minN,
											doctrineConstants.wilsonZ,
										)}
									</p>
								{:else}
									<!-- Honest-absence: provenance.methodology carries the authoritative
									     min_n_rate / wilson_z; when it has not loaded we say so rather
									     than printing a hardcoded 30 / 1.96. -->
									<p
										class="metric__prose metric__not"
										role="status"
										data-testid="metrics-doctrine-absent"
									>
										{t.provenance.howWeMeasure.constants.absent}
									</p>
								{/if}
							</div>
						</div>

						<div class="metrics-legend">
							<SectionLabel text={t.confidence.label} variant="metric" />
							<ul class="metrics-legend__list">
								{#each Object.entries(t.confidence.levels) as [level, info] (level)}
									<li class="metrics-legend__item">
										<span class="metrics-chip">{info.chip}</span>
										<span class="metrics-legend__meaning">{info.meaning}</span>
									</li>
								{/each}
							</ul>
						</div>
					</div>
				</CollapsibleSection>
			</div>

			<!-- One collapsible section card per metric, in cluster order. The cluster
			     overline groups them; the card number badge is the continuous index. -->
			{#each groups as group (group.cluster)}
				<div class="metrics-cluster">
					<SectionHeading level={2} overline={group.label} class="metrics-cluster__overline" />
					{#each group.entries as entry (entry.key)}
						{@const metricIndex = orderedMetrics.findIndex((m) => m.key === entry.key)}
						{@const note = methodologyNote(entry)}
						<div class="section-block" id={entry.anchor}>
							<CollapsibleSection
								title={entry.name[locale]}
								subtitle={entry.oneLiner[locale]}
								anchor={entry.anchor}
								index={metricIndex}
								sectionKey={cardKey(entry.anchor)}
								open={true}
								closeSignal={cardCloseSignal}
								openSignal={cardOpenSignal(entry.anchor)}
								bulkCollapsed={quietModeStore.enabled}
							>
								<div class="metric__body">
									<p class="metric__meta">
										<code class="metric__sci">{entry.sciName}</code>
										<span class="metrics-chip metrics-chip--meta">{confidenceMeaning(entry)}</span>
									</p>

									<div class="metric__block">
										<SectionLabel text={t.sections.definition} variant="metric" />
										<!-- EasterProse: definition prose carries the tasteful D4 easter-word
										     flourish (buses / trains / science / agencies), decoration-only. -->
										<EasterProse text={entry.definition[locale]} class="metric__prose" />
									</div>

									<div class="metric__block">
										<SectionLabel text={t.sections.math} variant="metric" />
										<p class="metric__prose metric__prose--mono">{entry.math[locale]}</p>
									</div>

									<div class="metric__block">
										<SectionLabel text={t.sections.sql} variant="metric" />
										<CodeBlock
											code={entry.sql}
											lang="SQL"
											ariaLabel={`${t.sqlAria}: ${entry.sciName}`}
										/>
									</div>

									<div class="metric__block">
										<SectionLabel text={t.sections.notReally} variant="metric" />
										<EasterProse text={entry.notReally[locale]} class="metric__prose metric__not" />
									</div>

									<div class="metric__block">
										<SectionLabel text={t.sections.caveats} variant="metric" />
										<ul class="metric__caveats">
											{#each entry.caveats[locale] as caveat, i (i)}
												<li>{caveat}</li>
											{/each}
										</ul>
									</div>

									<!-- Live pipeline note: the verbatim provenance.methodology string
									     for this metric from the CURRENT build, distinguished from the
									     static science above. Stands down entirely when unmapped/absent.
									     `note` is bound once at the #each level (above) — looked up once,
									     used as the guard AND the body. -->
									{#if note}
										<div class="metric__block metric__note-block" data-slot="pipeline-note">
											<SectionLabel text={t.sections.pipelineNote} variant="metric" />
											<p class="metric__prose metric__pipeline-note">{note}</p>
										</div>
									{/if}

									<a class="metric__top" href="#metrics-provenance">{t.backToTop}</a>
								</div>
							</CollapsibleSection>
						</div>
					{/each}
				</div>
			{/each}

			<!-- Live vehicle positions: the honest "almost real-time, not real-time"
			     explainer for how the live map DRAWS moving buses. Same collapsible-card
			     spine as the methodology sections, with an icon badge (not a metric
			     number); carries the deep-link target id + data-toc anchor the on-map
			     "How this works" link points at (/metrics#live-positions). -->
			<div class="section-block metrics-live" id={LIVE_POSITIONS_ANCHOR}>
				<CollapsibleSection
					title={t.livePositions.title}
					anchor={LIVE_POSITIONS_ANCHOR}
					sectionKey={cardKey(LIVE_POSITIONS_ANCHOR)}
					open={true}
					closeSignal={cardCloseSignal}
					openSignal={cardOpenSignal(LIVE_POSITIONS_ANCHOR)}
					bulkCollapsed={quietModeStore.enabled}
				>
					{#snippet icon()}
						<SectionIcon name="chart" class="h-4 w-4 shrink-0 text-primary" />
					{/snippet}
					<div class="metric__body">
						<p class="metric__prose metrics-live__lede">{t.livePositions.lede}</p>
						<ul class="metrics-live__list">
							{#each t.livePositions.points as point (point.heading)}
								<li class="metrics-live__point">
									<h3 class="metrics-live__heading">{point.heading}</h3>
									<p class="metric__prose">{point.body}</p>
								</li>
							{/each}
						</ul>
						<a class="metric__top" href="#metrics-provenance">{t.backToTop}</a>
					</div>
				</CollapsibleSection>
			</div>

			<!-- Structural gaps ("Lacunes"): the honest close — what these metrics
			     CANNOT tell the rider. Same collapsible-card spine as the methodology
			     sections, but an icon badge (not a metric number) marks it as a
			     non-metric section; carries the deep-link target id + data-toc anchor. -->
			<div class="section-block metrics-lacunes" id={LACUNES_ANCHOR}>
				<CollapsibleSection
					title={t.lacunes.title}
					anchor={LACUNES_ANCHOR}
					sectionKey={cardKey(LACUNES_ANCHOR)}
					open={true}
					closeSignal={cardCloseSignal}
					openSignal={cardOpenSignal(LACUNES_ANCHOR)}
					bulkCollapsed={quietModeStore.enabled}
				>
					{#snippet icon()}
						<SectionIcon name="eye" class="h-4 w-4 shrink-0 text-primary" />
					{/snippet}
					<div class="metric__body">
						<p class="metric__prose metrics-lacunes__lede">{t.lacunes.lede}</p>
						<ul class="metrics-lacunes__list">
							{#each t.lacunes.gaps as gap (gap.heading)}
								<li class="metrics-lacunes__gap">
									<h3 class="metrics-lacunes__heading">{gap.heading}</h3>
									<p class="metric__prose">{gap.body}</p>
								</li>
							{/each}
						</ul>
						<a class="metric__top" href="#metrics-provenance">{t.backToTop}</a>
					</div>
				</CollapsibleSection>
			</div>
		</div>
	{/snippet}
</DetailShell>

<!-- The floating mobile ToC pill now lives INSIDE DetailShell (it owns the observer +
     the pill), so it is no longer rendered here. The 1024–1279 re-show hack is gone too:
     the shell's rails appear at the SAME 1024 boundary the pill hides at, so the handoff
     is seamless with no gap band. -->

<style>
	/* The article LEDE — the framing paragraph that opens the reading column. */
	.metrics-lede {
		margin: 0;
		color: var(--secondary-foreground);
		max-width: 60ch;
	}

	/* ── Left rail (ToC + SEC readout) ─────────────────────────────────────────
	   The rail's own vertical rhythm; the SEC readout sits above the ToC. DetailShell
	   shows/hides the whole left rail at 1024 (the floating TocPill covers below), so
	   this only owns the in-rail stacking. */
	.metrics-toc-rail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	/* ── Sections column (the reading measure) ─────────────────────────────────
	   The center column of the 3-col template; caps to the article measure so the
	   cards read at a comfortable width whatever the track resolves to. */
	.sections-column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		min-width: 0;
		max-width: 60rem;
	}

	/* ── Right rail / mobile summary stat cards ────────────────────────────────
	   Provenance / Coverage / Freshness — compact cards fed from data the page
	   already has. On desktop they stack in the sticky right rail; on mobile the
	   SAME markup reflows into the top summary strip (a horizontal row that wraps).
	   No data marks, no --primary (the honesty chips + stamp carry their own tone). */
	.metrics-stat-aside {
		min-width: 0;
	}
	.metrics-stat-rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
	}
	/* Mobile summary strip: lay the three cards in a wrapping row so they read as a
	   compact strip above the sections, not a tall stack. */
	:global(.detail-shell-mobile-summary) .metrics-stat-rail {
		flex-direction: row;
		flex-wrap: wrap;
	}
	:global(.detail-shell-mobile-summary) .metrics-stat-rail > :global([data-slot='card']) {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.metrics-stat__body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.metrics-stat__body[data-slot='stat-freshness'] :global(.freshness-stamp-label) {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.metrics-stat__note {
		margin: 0;
		color: var(--muted-foreground);
		font-size: 0.95rem;
		line-height: 1.45;
	}
	.metrics-stat__count {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		margin: 0;
	}
	.metrics-stat__big {
		font-family: var(--font-heading);
		font-size: 1.75rem;
		font-weight: 800;
		line-height: 1;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.metrics-stat__unit {
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.metrics-stat__sub {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	.metrics-stat__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* ── Provenance preamble ─────────────────────────────────────────────────── */
	/* Deep-link/ToC scroll offset is owned globally (app.css `[data-toc]` rule off
	   --chrome-offset) — no per-surface scroll-margin literal here. */
	.metrics-article-prose {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: var(--container-content);
	}
	.metrics-preamble {
		margin: 0;
		color: var(--muted-foreground);
		max-width: 68ch;
	}
	.metrics-conformance {
		display: flex;
	}
	/* Provenance stand-down: a quiet, muted line that takes the badge's slot when
	   the supplementary fetch fails. Not a data verdict (no dataviz status colour),
	   not --primary; it just states the live check is momentarily out. */
	.metrics-provenance-down {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.6;
		max-width: 68ch;
	}
	/* How-we-measure: named convention notes inside the provenance preamble. Reads
	   as discrete heading + body blocks, on the same muted prose voice as the rest of
	   the preamble (no data marks, no --primary). */
	.metrics-measure {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.metrics-measure__item {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.metrics-measure__heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 600;
		line-height: 1.4;
		color: var(--foreground);
	}
	.metrics-legend {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.metrics-legend__list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-legend__item {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
	}
	.metrics-legend__meaning {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
	}
	/* The confidence chip: a quiet, muted pill (NOT a data mark, NOT --primary). */
	.metrics-chip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--muted);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		white-space: nowrap;
	}
	.metrics-chip--meta {
		font-size: var(--text-micro);
	}

	/* ── Cluster bands ───────────────────────────────────────────────────────── */
	.metrics-cluster {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	:global(.metrics-cluster__overline) {
		margin-block-end: 0.25rem;
	}

	/* The .section-block elements carry the deep-link target id (so /metrics#otp
	   scrolls here natively); their scroll landing is offset globally by the
	   app.css `[id]` rule off --chrome-offset (no per-surface scroll-margin). */

	/* ── Metric card body (inside the shared CollapsibleSection) ─────────────── */
	.metric__body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.metric__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin: 0;
	}
	.metric__sci {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.metric__block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.metric__prose {
		margin: 0;
		color: var(--foreground);
		max-width: 68ch;
	}
	.metric__prose--mono {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		line-height: 1.7;
	}
	.metric__not {
		color: var(--muted-foreground);
	}
	/* Live pipeline note: a quiet card-inset block, set apart from the static
	   science by its muted surface + hairline frame (P7: no left stripe). The
	   verbatim methodology string reads on the mono caption voice. */
	.metric__note-block {
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--muted);
	}
	.metric__pipeline-note {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		line-height: 1.7;
	}
	.metric__caveats {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding-inline-start: 1.1rem;
		color: var(--muted-foreground);
		max-width: 72ch;
	}
	/* ── Structural-gaps card ─────────────────────────────────────────────────
	   Same card spine as a metric section; the gap list reads as discrete named
	   blocks (heading + plain body), separated by a hairline rule so each gap is a
	   clear, self-contained admission. No data marks, no --primary. */
	.metrics-lacunes__lede {
		color: var(--muted-foreground);
	}
	.metrics-lacunes__list {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-lacunes__gap {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-block-start: 1.25rem;
		border-block-start: 1px solid var(--border-hairline, var(--border));
	}
	.metrics-lacunes__gap:first-child {
		padding-block-start: 0;
		border-block-start: none;
	}
	.metrics-lacunes__heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 600;
		line-height: 1.4;
		color: var(--foreground);
	}

	/* ── Live-positions card ──────────────────────────────────────────────────
	   Same card spine as the structural-gaps card: the points read as discrete
	   named blocks (heading + plain body), separated by a hairline rule so each is
	   a clear, self-contained admission. No data marks, no --primary. */
	.metrics-live__lede {
		color: var(--muted-foreground);
	}
	.metrics-live__list {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-live__point {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-block-start: 1.25rem;
		border-block-start: 1px solid var(--border-hairline, var(--border));
	}
	.metrics-live__point:first-child {
		padding-block-start: 0;
		border-block-start: none;
	}
	.metrics-live__heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 600;
		line-height: 1.4;
		color: var(--foreground);
	}

	.metric__top {
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--primary);
		text-decoration: none;
		transition: opacity var(--duration-normal) var(--ease-default);
	}
	.metric__top:hover,
	.metric__top:focus-visible {
		text-decoration: underline;
	}
	.metric__top:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.metrics-article-prose,
	.metric__prose,
	.metric__caveats,
	.metrics-live__lede,
	.metrics-live__point p,
	.metrics-lacunes__lede,
	.metrics-lacunes__gap p {
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
	}

	@media (min-width: 1024px) {
		.metrics-article-prose,
		.metric__prose,
		.metric__caveats,
		.metrics-live__lede,
		.metrics-live__point p,
		.metrics-lacunes__lede,
		.metrics-lacunes__gap p {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}

	/* Formula and current-run note rows stay on their compact mono treatment. */
	.metric__prose--mono,
	.metric__pipeline-note {
		font-size: var(--text-caption);
		line-height: 1.7;
	}

	@media (max-width: 24rem) {
		:global(.detail-shell-mobile-summary) .metrics-stat-rail {
			flex-direction: column;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.metric__top {
			transition: none;
		}
	}
</style>
