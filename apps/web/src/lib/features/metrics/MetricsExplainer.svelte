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

    · HEADER slot → the Masthead (kicker / heading / lede / meta) + CornerMeta, dropped
      into the shell's full-bleed header band, which on this page carries the
      MetricsBlueprint drafting wall (P5-R R3 "blueprints for the headers"; the dot-grid
      stands down). The Masthead runs `tape={false}`; DetailShell adds the edge-to-edge
      closing `<Separator variant="hazard">` tape. The shared QuietModeButton (FOCUS +
      REMEMBER, site-wide store) + the expand-all control ride the Masthead meta row.
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

  Composes: DetailShell (header band + hazard tape + 3-col grid + observer + pill) +
  Masthead + CornerMeta + SectionLabel + the shared CodeBlock (SQL syntax chrome) + the
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
	import { getLocale, type Locale } from '$lib/i18n';
	import { getProvenance, getV1Context } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ConformanceBadge, FreshnessStamp } from '$lib/components/surface';
	import { DetailShell } from '$lib/components/layout';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import Masthead from '$lib/components/brand/Masthead.svelte';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import MetricsBlueprint from './MetricsBlueprint.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import { formatUtc } from '$lib/utils/time';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import {
		CollapsibleSection,
		SectionIcon,
		TocNav,
		tocElement,
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

	// CornerMeta readouts (A4) for the masthead — REAL data only. Provider + dataset
	// version are always present from the manifest; the generated stamp + source-feed
	// count come from the provenance document (supplementary, so those two corners drop
	// until it settles). A missing datum drops its corner, never fabricated.
	const manifest = getV1Context().manifest;
	const cm = cornerMetaLabels[locale];
	const cornerShortName = manifest.short_name?.trim() || manifest.display_name;
	const cornerGeneratedStamp = $derived(
		provenance.data?.generated_utc != null
			? formatUtc(provenance.data.generated_utc, locale)
			: null,
	);
	const cornerSourceCount = $derived(provenance.data?.sources?.length ?? null);

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
	// This page only WIRES the store's signals into its cards + ToC and keeps its
	// own bulk expand/collapse control (the switch itself renders + reads the
	// store inside the shared QuietModeButton).

	// Bulk collapse-all edge (§C5.8) — page-owned, cards only (the documented
	// intent: the bulk control never folds the ToC; only FOCUS does).
	let bulkCloseSignal = $state(0);

	// Cards fold on EITHER edge (FOCUS ON or collapse-all): monotonic counters sum
	// into one card-facing close signal. The ToC folds only with FOCUS.
	const cardCloseSignal = $derived(bulkCloseSignal + quietModeStore.closeSignal);
	// FOCUS OFF reopens every card + the ToC (the yesid contract).
	const focusOpenSignal = $derived(quietModeStore.openSignal);

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
	const cardOpenSignal = (anchor: string): number => cardOpenSignals[anchor] ?? 0;

	// Open a specific card by anchor by bumping its open-signal (the same mechanism
	// FOCUS uses to CLOSE cards, in reverse). Used by the mount + hashchange opener
	// and by ToC navigation, so a closed target is opened before we scroll to it.
	function openCard(anchor: string): void {
		cardOpenSignals = { ...cardOpenSignals, [anchor]: cardOpenSignal(anchor) + 1 };
	}

	// ── Expand-all / collapse-all (§C5.8) ───────────────────────────────────────
	// A single toggle over EVERY collapsible card. "Collapse all" bumps the bulk
	// close signal (cards only — the ToC stays); "Expand all" bumps each openable
	// anchor's open-signal (reusing the per-card opener). Default-open page → the
	// control starts as "Collapse all". The flag flips the label; a reader's
	// individual card toggles afterwards don't sync it back (best-effort bulk
	// control, not a live mirror of every card's state).
	let allExpanded = $state(true);
	function toggleExpandAll(): void {
		if (allExpanded) {
			bulkCloseSignal += 1;
			allExpanded = false;
		} else {
			for (const anchor of openableAnchors) openCard(anchor);
			allExpanded = true;
		}
	}

	// The set of anchors that correspond to a COLLAPSIBLE CARD (every metric card
	// + the live-positions + structural-gaps cards). The provenance preamble is a
	// plain <section>, NOT a card, so its anchor is deliberately absent: a deep-link
	// to it scrolls without any open logic (the "opener must distinguish" contract —
	// opening a non-collapsible section is the lane-1 risk we guard against here).
	const openableAnchors = $derived(
		new Set<string>([
			...orderedMetrics.map((m) => m.anchor),
			LIVE_POSITIONS_ANCHOR,
			LACUNES_ANCHOR,
		]),
	);

	// ── Hash opener (mount + hashchange) ───────────────────────────────────────
	// A deep-link to /metrics#<anchor> (an (i) MetricInfo tip, an on-map "How this
	// works" link, a shared URL) must REVEAL its target on a default-closed page. If
	// the hash names a collapsible card, open ONLY that card, then let the native
	// anchor scroll land on it; a non-card anchor (the provenance preamble) is left
	// to scroll on its own. Runs once on mount (for the initial hash) and on every
	// hashchange (same-page (i) navigation swaps the hash without a remount).
	function openFromHash(): void {
		const raw = window.location.hash.replace(/^#/, '');
		if (!raw) return;
		// A malformed fragment ('#%' etc.) must not throw during mount — the anchors
		// are plain ASCII, so an undecodable hash simply cannot match (S10 review F2).
		let anchor: string;
		try {
			anchor = decodeURIComponent(raw);
		} catch {
			return;
		}
		if (openableAnchors.has(anchor)) openCard(anchor);
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
			window.removeEventListener('hashchange', openFromHash);
		};
	});

	// ── Page-title flourish (D4) ───────────────────────────────────────────────
	// The house wordmark hover treatment on the /metrics title: reuse the SAME
	// effect family (bounce / wiggle / wave / spin) on the Masthead display
	// heading. The heading is rendered by the shared SectionHeading primitive
	// (`.section-heading-text`), so we grab it from the bound header on mount rather
	// than modify that shared component. easterWordHover self-disables on touch +
	// reduced-motion (those readers get a static title) and lazy-loads GSAP, so the
	// flourish never touches the critical path or the a11y/reduced-motion contract.
	let headerEl = $state<HTMLElement>();
	onMount(() => {
		const titleEl = headerEl?.querySelector<HTMLElement>('.section-heading-text');
		if (!titleEl) return;
		let action: { destroy(): void } | undefined;
		let cancelled = false;
		void import('./easterWordHover')
			.then(({ easterWordHover }) => {
				if (cancelled) return;
				action = easterWordHover(titleEl, { autoPlay: true, autoPlayDelay: 550 });
			})
			.catch(() => {
				/* pure flourish — a failed chunk leaves a static title */
			});
		return () => {
			cancelled = true;
			action?.destroy();
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
	// The provenance preamble is not a card, so it just scrolls. await tick() keeps
	// the scroll a frame after the reactive open settles. Reduced-motion drops the
	// smooth scroll.
	async function navigate(id: string): Promise<void> {
		if (openableAnchors.has(id)) openCard(id);
		await tick();
		tocElement(id)?.scrollIntoView({
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
			block: 'start',
		});
	}
</script>

<!-- The right-rail / mobile-summary stat cards — Provenance / Coverage / Freshness,
     all built from data the page already has (the live conformance verdict, the
     metric+cluster counts + confidence legend, and generated_utc). Rendered ONCE
     here and dropped into both the desktop right rail and the mobile top strip. -->
{#snippet statCards()}
	<div class="metrics-stat-rail">
		<!-- Provenance: the live feed-conformance verdict (the same honesty signal
		     the preamble carries), or an honest stand-down when it can't load. -->
		<div class="metrics-stat" data-slot="stat-provenance">
			<span class="metrics-stat__title">{t.statRail.provenance.title}</span>
			{#if provenance.data?.conformance}
				<ConformanceBadge conformance={provenance.data.conformance} {locale} />
			{:else if provenanceUnavailable}
				<p class="metrics-stat__note" role="status">{t.statRail.provenance.unavailable}</p>
			{/if}
		</div>

		<!-- Coverage: the shape of the page — how many metrics across how many
		     families, plus the confidence legend chips. Pure static counts. -->
		<div class="metrics-stat" data-slot="stat-coverage">
			<span class="metrics-stat__title">{t.statRail.coverage.title}</span>
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

		<!-- Freshness: when this methodology build's provenance document was generated
		     (the calm "Updated N ago" stamp — never a live-tier LIVE chip). -->
		{#if provenance.data?.generated_utc}
			<div class="metrics-stat" data-slot="stat-freshness">
				<span class="metrics-stat__title">{t.statRail.freshness.title}</span>
				<FreshnessStamp variant="updated" generatedUtc={provenance.data.generated_utc} {locale} />
			</div>
		{/if}
	</div>
{/snippet}

<!-- The header controls — the shared FOCUS switch + REMEMBER pin (site-wide
     quietModeStore) beside the page-owned expand/collapse-all — ride the Masthead
     meta row (the mono header-control zone), below the subheading line. -->
{#snippet masthead()}
	<span class="metrics-subhead">{t.subheading}</span>
	<div class="metrics-meta-controls">
		<QuietModeButton />
		<!-- Expand-all / collapse-all (§C5.8): one control to open or close every card. -->
		<button
			type="button"
			class="metrics-expand-all"
			aria-pressed={allExpanded}
			aria-label={allExpanded ? t.expand.collapseAll : t.expand.expandAll}
			data-testid="metrics-expand-all"
			onclick={toggleExpandAll}
		>
			<span>{allExpanded ? t.expand.collapseAll : t.expand.expandAll}</span>
		</button>
	</div>
{/snippet}

<article class="metrics-article" data-testid="metrics-article">
	<DetailShell
		class="metrics-detail"
		bind:activeId
		{tocEntries}
		onNavigate={navigate}
		tocOpenAria={t.tocPill.open}
		tocCloseAria={t.tocPill.close}
	>
		<!-- The article-cover BLUEPRINT (P5-R R3): the Bridge-elevation drafting wall
		     behind the Masthead, scroll-drawn on capable viewports, static under PRM
		     and below 1024. Replaces the dot-grid band on this page. -->
		{#snippet blueprintArt()}
			<MetricsBlueprint />
		{/snippet}

		<!-- Masthead (the ONE head family): kicker → display title + orange dot → lede →
		     meta row (subheading + FOCUS controls). The DetailShell owns the full-bleed
		     dot-grid header band + the closing hazard tape, so the Masthead runs tape={false}
		     and the content just drops CornerMeta + Masthead into the band's centered inner. -->
		{#snippet header()}
			<!-- headerEl hosts the display title for the D-effect motion + is the relative
			     host CornerMeta pins its four corners to. -->
			<div class="metrics-header-content" bind:this={headerEl}>
				<!-- A4: blueprint-margin corners on the masthead — provider · generated ·
				     dataset · source count (real data from the manifest + provenance).
				     aria-hidden, hidden < 768px. -->
				<CornerMeta>
					{#snippet topLeft()}<span class="metrics-corner">{cm.provider} · {cornerShortName}</span
						>{/snippet}
					{#snippet topRight()}{#if cornerGeneratedStamp}<span class="metrics-corner"
								>{cm.generated} · {cornerGeneratedStamp}</span
							>{/if}{/snippet}
					{#snippet bottomLeft()}<span class="metrics-corner"
							>{cm.dataset} · {manifest.dataset_version}</span
						>{/snippet}
					{#snippet bottomRight()}{#if cornerSourceCount != null}<span class="metrics-corner"
								>{cm.sources} · {cornerSourceCount}</span
							>{/if}{/snippet}
				</CornerMeta>
				<Masthead
					kicker={t.kicker}
					heading={t.heading}
					lede={t.lede}
					meta={masthead}
					tape={false}
				/>
			</div>
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
					openSignal={focusOpenSignal}
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
				<!-- Provenance preamble: the honest framing every number inherits. Carries
			     the data-toc anchor so it is the FIRST tracked ToC target (active-section
			     observer + click-to-scroll), mirroring the structural-gaps card pattern. -->
				<section
					class="metrics-prose"
					aria-labelledby="metrics-provenance"
					data-toc={PROVENANCE_ANCHOR}
				>
					<SectionHeading level={2} id="metrics-provenance" overline={t.provenance.label} />
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
							<h3 class="metrics-measure__heading">{t.provenance.howWeMeasure.rounding.heading}</h3>
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
				</section>

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
									openSignal={cardOpenSignal(entry.anchor) + focusOpenSignal}
								>
									<div class="metric__body">
										<p class="metric__meta">
											<code class="metric__sci">{entry.sciName}</code>
											<span class="metrics-chip metrics-chip--meta">{confidenceMeaning(entry)}</span
											>
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
											<EasterProse
												text={entry.notReally[locale]}
												class="metric__prose metric__not"
											/>
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
						openSignal={cardOpenSignal(LIVE_POSITIONS_ANCHOR) + focusOpenSignal}
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
						openSignal={cardOpenSignal(LACUNES_ANCHOR) + focusOpenSignal}
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
</article>

<!-- The floating mobile ToC pill now lives INSIDE DetailShell (it owns the observer +
     the pill), so it is no longer rendered here. The 1024–1279 re-show hack is gone too:
     the shell's rails appear at the SAME 1024 boundary the pill hides at, so the handoff
     is seamless with no gap band. -->

<style>
	/* The surface is a measured article rendered through DetailShell, which owns the
	   full-bleed dot-grid header band + the edge-to-edge hazard tape + the 3-col body
	   grid. This feature supplies only the CONTENT of each slot. */
	.metrics-article {
		display: block;
		width: 100%;
	}

	/* The header slot content — the relative host CornerMeta pins its four corners to,
	   and the element the D-effect motion queries for the display title. The shell's
	   header band supplies the dot-grid ground + centered measure around it; a ≥768px
	   padding-block band (only where the corners surface) keeps them clear of the kicker
	   + controls (the same corner-clearance idiom the home Masthead uses). */
	.metrics-header-content {
		position: relative;
	}
	@media (min-width: 768px) {
		.metrics-header-content {
			padding-block: 1.75rem;
		}
	}
	.metrics-corner {
		white-space: nowrap;
	}
	/* The subheading line ("// PROXY…") leads the Masthead meta row; it reads
	   in the mono micro voice the old SurfaceHeader subheading carried. */
	.metrics-subhead {
		flex-basis: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		letter-spacing: 2px;
		text-transform: uppercase;
		color: var(--muted-foreground);
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
	.metrics-article :global(.detail-shell-mobile-summary .metrics-stat-rail) {
		flex-direction: row;
		flex-wrap: wrap;
	}
	.metrics-article :global(.detail-shell-mobile-summary .metrics-stat) {
		flex: 1 1 12rem;
	}
	.metrics-stat {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--muted);
		min-width: 0;
	}
	.metrics-stat__title {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.metrics-stat__note {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-caption);
		line-height: 1.5;
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
		font-size: var(--text-caption);
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
	.metrics-prose {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: var(--container-content);
	}
	.metrics-preamble {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.7;
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
		font-size: var(--text-small);
		line-height: 1.7;
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
		font-size: var(--text-small);
		line-height: 1.6;
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
	/* ── Masthead meta controls row ────────────────────────────────────────────
	   The shared QuietModeButton pair (FOCUS + REMEMBER, its own chassis) beside
	   the page-owned expand/collapse-all pill, one mono control zone. */
	.metrics-meta-controls {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.metrics-expand-all {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding-inline: 0.875rem;
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-md);
		background: var(--background);
		box-shadow: inset 0 1px 0 var(--edge-highlight);
		color: var(--secondary-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-control);
		letter-spacing: 0;
		cursor: pointer;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default);
	}
	.metrics-expand-all:hover,
	.metrics-expand-all:focus-visible,
	.metrics-expand-all[aria-pressed='true'] {
		border-color: var(--primary);
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 7%, var(--background));
	}
	.metrics-expand-all:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
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

	@media (prefers-reduced-motion: reduce) {
		.metric__top,
		.metrics-expand-all {
			transition: none;
		}
	}
</style>
