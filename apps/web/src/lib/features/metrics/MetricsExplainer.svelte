<!--
  MetricsExplainer: the /metrics surface screen (slice-9.6).

  The in-app metric explainer. For every citizen-facing reliability metric it
  renders, grouped by the five reliability clusters: a definition, the math, the
  verbatim Defining SQL, a "what it's NOT" misread warning, and the honest
  caveats, all bilingual (FR canonical). A (i) tip on the reliability surface
  deep-links here at each metric's anchor.

  SHELL: a MEASURED ARTICLE built 1:1 on the yesid.dev blog/project detail-page
  shell (the SAME shared components, on transit tokens + i18n; we are one brand,
  not lookalikes). This is a PROSE / methodology page — the sibling of yesid's
  blog/[slug] + projects/[slug] — so it is measured, NOT full-bleed:

    · A full-bleed ARTICLE HEADER band carrying the .detail-header-grid dot-grid
      chrome (the "Manifesto schematic" behind the yesid detail headers) + the
      SurfaceHeader (kicker / heading / lede) + the quiet-mode switch, closed off
      by an edge-to-edge `<Separator variant="hazard">` stripe — 1:1 with the blog/
      projects detail header + hazard separator.
    · The `.body-grid` below it is the yesid article grid: max-width container-wide,
      centred, with the page gutter; at lg it becomes a TWO-column grid
      `minmax(13rem,17rem) | minmax(0,1fr)` — a TOC rail + a wide reading column
      (slice-9.8-B widened the column to ~60rem into the reclaimed third-rail space).
    · DESKTOP (>=lg): a sticky table-of-contents rail (shared TocNav) on the left +
      the measured content column on the right. The rail tracks the current section
      (activeId) and scrolls to its target on click. The ToC carries its OWN
      user-driven collapse (its chevron, persisted via sectionKey="metrics-toc").
      S10 (2026-07-02): the rail ALSO follows FOCUS now (yesid Quiet-Mode parity) —
      FOCUS ON folds it (closeSignal), FOCUS OFF reopens it (openSignal); the
      reader's manual chevron still works between signals.
    · The provenance preamble + one CollapsibleSection card PER METRIC (number
      badge, `data-toc` anchor, deep-link `id` on the section block) carry the
      definition / math / SQL / "what it's NOT" / caveats. S10: every card is
      DEFAULT-CLOSED with its own persisted open-state (sectionKey
      `metrics-card-<anchor>`); a mount/hashchange opener + ToC navigation open a
      target card so deep-links + jumps reveal content on the default-closed page.
    · MOBILE (<lg): the shared TocPill floating pill + drawer drives the same
      activeId/onNavigate.
    · ONE IntersectionObserver (observeActiveToc over `[data-toc]`) owns activeId
      and feeds BOTH the rail and the pill (no duplicate observers).

  Composes the brand/layout spine: the article header band (SurfaceHeader +
  .detail-header-grid) + the hazard Separator + SectionLabel + the shared CodeBlock
  (SQL syntax chrome) + the shared shared/ TOC + collapsible-card kit
  (CollapsibleSection / TocNav / TocPill / toc.ts). The co-located
  metrics/+layout.svelte is a bare pass-through (S10 retired the rotated edge-word
  grid + accent-rail + metro dots — see that file's header); all of this surface's
  chrome (header band, hazard stripe, body grid) lives right here.

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
	import {
		ArticleShell,
		DetailTemplate,
		VerticalSectionTitle,
		verticalSectionTitleWord,
	} from '$lib/components/layout';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import { formatUtc } from '$lib/utils/time';
	import SectionProgress from '$lib/components/brand/SectionProgress.svelte';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import {
		CollapsibleSection,
		SectionIcon,
		TocNav,
		TocPill,
		observeActiveToc,
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
	// A restrained header control that enters a distraction-free reading state for
	// the methodology article (mirrors the yesid.dev detail-page "Quiet mode" switch).
	//
	// S10 (2026-07-02) — DEFAULT-CLOSED + FOCUS parity. The page is now a scannable
	// stack of CLOSED cards on first visit (D3): each metric/lacunes/live-positions
	// card owns its own persisted open-state (sectionKey `metrics-card-<anchor>`),
	// default closed, and a reader opens the ones they want (or jumps from the ToC /
	// an (i) deep-link, which opens the target). FOCUS is reconciled to yesid's
	// Quiet-Mode signal contract:
	//   · FOCUS ON  → collapse EVERY card AND fold the ToC rail (closeSignal bump).
	//   · FOCUS OFF → reopen the ToC rail (tocOpenSignal bump); the cards STAY closed
	//     (deviation from yesid's openSignal-opens-ALL: the page is default-closed, so
	//     unfocus must not explode all 14 cards open — the operator's focused-
	//     experience mandate). Only the ToC receives the open signal; cards do not.
	// This replaces the pre-S10 model where FOCUS drove a single global `cardsOpen`
	// and the ToC was documented Focus-INDEPENDENT.
	//
	// slice-9.8-B — SESSION-BY-DEFAULT, OPTIONALLY PINNED. Two controls now sit in
	// the header (the yesid QuietModeButton pair):
	//   1. the FOCUS switch — toggles the card-collapse for THIS session only.
	//   2. the REMEMBER pin — when engaged, the FOCUS preference is remembered across
	//      visits; when off, FOCUS resets to its default each fresh visit.
	//
	// Persistence model (SSR-safe; every read/write is window-guarded so the server
	// + tests render the default layout and the stored prefs re-apply on mount with
	// no mid-paint flash):
	//   · metrics-focus-remembered (localStorage '1'/'0') — the PIN: does the FOCUS
	//     preference survive across visits?
	//   · metrics-quiet (localStorage '1'/'0') — the remembered FOCUS value, read on
	//     mount ONLY when pinned.
	//   · metrics-quiet (sessionStorage '1'/'0') — the unpinned, session-scoped FOCUS
	//     value, read on mount when NOT pinned (survives same-tab nav, not a new visit).
	const QUIET_STORAGE_KEY = 'metrics-quiet';
	const REMEMBER_STORAGE_KEY = 'metrics-focus-remembered';
	let quiet = $state(false);
	let remembered = $state(false);

	// S10 FOCUS signals (yesid closeSignal/openSignal idiom, page-owned). Bumping
	// `closeSignal` collapses every card + folds the ToC; bumping `tocOpenSignal`
	// reopens the ToC ONLY (cards stay closed — the default-closed deviation).
	// Cards receive `closeSignal` alone; the ToC receives both. Monotonic counters
	// so CollapsibleSection's edge-triggered effects never fire on a fresh mount.
	let closeSignal = $state(0);
	let tocOpenSignal = $state(0);

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

	onMount(() => {
		try {
			remembered = localStorage.getItem(REMEMBER_STORAGE_KEY) === '1';
			// Pinned → restore the remembered value from localStorage. Unpinned →
			// FOCUS is session-scoped, so restore only a same-tab session value.
			quiet = remembered
				? localStorage.getItem(QUIET_STORAGE_KEY) === '1'
				: sessionStorage.getItem(QUIET_STORAGE_KEY) === '1';
			// A restored FOCUS-ON must collapse the cards it applies to (they default
			// closed anyway, but be explicit) AND fold the ToC — bump the close signal
			// so the page paints in the focused state.
			if (quiet) closeSignal += 1;
		} catch {
			/* private mode / disabled storage — session-only FOCUS is fine */
		}
	});

	// Write the current FOCUS value to whichever store its persistence scope owns:
	// localStorage when pinned (remembered across visits), sessionStorage otherwise
	// (this tab only). We keep the two stores from fighting by clearing the other.
	function persistQuiet(): void {
		try {
			if (remembered) {
				localStorage.setItem(QUIET_STORAGE_KEY, quiet ? '1' : '0');
				sessionStorage.removeItem(QUIET_STORAGE_KEY);
			} else {
				sessionStorage.setItem(QUIET_STORAGE_KEY, quiet ? '1' : '0');
				localStorage.removeItem(QUIET_STORAGE_KEY);
			}
		} catch {
			/* private mode / disabled storage — the in-memory toggle still works */
		}
	}

	function toggleQuiet(): void {
		quiet = !quiet;
		persistQuiet();
		// FOCUS ON → collapse every card + fold the ToC (closeSignal). FOCUS OFF →
		// reopen the ToC only (tocOpenSignal); the cards stay closed by design.
		if (quiet) closeSignal += 1;
		else tocOpenSignal += 1;
	}

	// Pin / unpin the FOCUS preference. Pinning promotes the current FOCUS value to
	// localStorage (remembered across visits); unpinning demotes it back to a
	// session value. Either way the current on-screen FOCUS state is unchanged —
	// only WHERE the preference lives (and how long it survives) changes.
	function toggleRemember(): void {
		remembered = !remembered;
		try {
			localStorage.setItem(REMEMBER_STORAGE_KEY, remembered ? '1' : '0');
		} catch {
			/* private mode / disabled storage — the in-memory pin still works */
		}
		persistQuiet();
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
	// effect family (bounce / wiggle / wave / spin) on the SurfaceHeader display
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
	// One IntersectionObserver over the section cards' [data-toc] anchors owns the
	// active id; the desktop rail and the mobile pill both receive it as a prop (no
	// duplicate observers). No-ops gracefully without IO (SSR / tests).
	let activeId = $state('');
	onMount(() => observeActiveToc((id) => (activeId = id)));

	// ── Reading-position readout (SEC n / m) for the left rail ───────────────────
	// The 1-based index of the active ToC entry (falls back to 1 before any section
	// is observed). Feeds SectionProgress alongside the ToC's own counter so the
	// left rail carries a persistent "where am I" signal even when the ToC is folded.
	const activeIndex = $derived.by(() => {
		const i = tocEntries.findIndex((e) => e.id === activeId);
		return i >= 0 ? i + 1 : 1;
	});

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

<!-- The header controls — the FOCUS switch + REMEMBER pin — ride the ArticleShell
     meta row (the mono header-control zone), below the subheading line. -->
{#snippet masthead()}
	<span class="metrics-subhead">{t.subheading}</span>
	<div class="metrics-quiet-controls">
		<button
			type="button"
			class="metrics-quiet-toggle"
			role="switch"
			aria-checked={quiet}
			aria-label={quiet ? t.quiet.disable : t.quiet.enable}
			data-testid="metrics-quiet-toggle"
			onclick={toggleQuiet}
		>
			<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
				<path class="q-wave" d="M8.4 8.4a5 5 0 0 0 0 7.2" />
				<path class="q-wave" d="M15.6 8.4a5 5 0 0 1 0 7.2" />
				<path class="q-wave q-wave--far" d="M5.7 5.7a8.9 8.9 0 0 0 0 12.6" />
				<path class="q-wave q-wave--far" d="M18.3 5.7a8.9 8.9 0 0 1 0 12.6" />
				<circle class="q-core" cx="12" cy="12" r="2.3" />
			</svg>
			<span>{t.quiet.label}</span>
		</button>
		<!-- Remember pin (slice-9.8-B): a paired switch that PINS the FOCUS
		     preference across visits. OFF = FOCUS is session-only; ON = the
		     current FOCUS choice is remembered next visit. The pin icon fills in
		     --primary when engaged. Independent of the FOCUS state itself. -->
		<button
			type="button"
			class="metrics-quiet-remember"
			role="switch"
			aria-checked={remembered}
			aria-label={remembered ? t.quiet.forget : t.quiet.remember}
			title={remembered ? t.quiet.forget : t.quiet.remember}
			data-testid="metrics-quiet-remember"
			onclick={toggleRemember}
		>
			<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
				<path class="r-pin" d="M12 17v4" />
				<path class="r-pin" d="M9 3h6l-1 6 3 3v1H7v-1l3-3-1-6z" />
			</svg>
			<span>{t.quiet.rememberLabel}</span>
		</button>
	</div>
{/snippet}

<article class="metrics-article" data-testid="metrics-article">
	<!-- D2: the rotated edge word in the left gutter (≥xl, decorative). -->
	<VerticalSectionTitle word={verticalSectionTitleWord('measure', locale)} />
	<DetailTemplate class="metrics-detail">
		<!-- Masthead → ArticleShell: kicker → display title + orange dot → lede → meta
		     row (subheading + FOCUS controls) → hazard tape. The full-bleed dot-grid
		     schematic band survives as the wrapper (`.detail-header-grid`). -->
		{#snippet head()}
			<div class="metrics-header detail-header-grid" bind:this={headerEl}>
				<div class="metrics-header__inner">
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
					<ArticleShell kicker={t.kicker} title={t.heading} lede={t.lede} meta={masthead} />
				</div>
			</div>
		{/snippet}

		<!-- Mobile top summary strip — the right-rail stats reflowed above the sections
		     (DetailTemplate hides this ≥xl, where the right rail carries them). -->
		{#snippet mobileSummary()}
			{@render statCards()}
		{/snippet}

		<!-- LEFT rail: the numbered ToC + the SEC n / m reading-position readout. -->
		{#snippet left()}
			<div class="metrics-toc-rail">
				<SectionProgress
					current={activeIndex}
					total={tocEntries.length}
					prefix={t.tocCounterPrefix}
				/>
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
					{closeSignal}
					openSignal={tocOpenSignal}
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
									anchor={entry.anchor}
									index={metricIndex}
									sectionKey={cardKey(entry.anchor)}
									open={false}
									{closeSignal}
									openSignal={cardOpenSignal(entry.anchor)}
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
						open={false}
						{closeSignal}
						openSignal={cardOpenSignal(LIVE_POSITIONS_ANCHOR)}
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
						open={false}
						{closeSignal}
						openSignal={cardOpenSignal(LACUNES_ANCHOR)}
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
	</DetailTemplate>
</article>

<!-- Mobile floating TOC pill (hidden ≥lg). onNavigate routes through the page's
     open-then-scroll path so a drawer jump reveals its card (S10 review F1). -->
<!-- The pill covers the whole sub-xl range: DetailTemplate's left rail only
     appears at ≥xl (1280px), so the floating pill must remain visible through the
     1024–1279 band where the layout is still single-column. TocPill hides itself
     ≥lg (1024px), so we re-show it up to xl here. -->
<div class="metrics-toc-pill-shell">
	<TocPill
		entries={tocEntries}
		{activeId}
		openAria={t.tocPill.open}
		closeAria={t.tocPill.close}
		onNavigate={navigate}
	/>
</div>

<style>
	/* ── Article shell ─────────────────────────────────────────────────────────
	   The whole surface is a measured article (the yesid blog/projects detail
	   page on transit tokens): a full-bleed header band, an edge-to-edge hazard
	   stripe, then the measured body grid. The article itself sets no max-width —
	   the header band + hazard span the rail-inset <main> width, and the body grid
	   owns the reading measure. */
	.metrics-article {
		display: flex;
		flex-direction: column;
		gap: 0;
		width: 100%;
		/* Anchor for the D2 rotated edge word's zero-width absolute rail. */
		position: relative;
	}

	/* D2: give the ≥xl grid (ToC · sections · stat rail) a left gutter so the
	   rotated edge word has a margin band to live in — clear of the app LeftRail on
	   its left and the ToC card on its right. The masthead stays full-bleed (the
	   dot-grid band spans edge-to-edge); only the grid content is inset. */
	@media (min-width: 1280px) {
		.metrics-article :global(.detail-grid) {
			padding-inline-start: var(--space-page-x);
		}
	}

	/* Full-bleed header band carrying the .detail-header-grid dot-grid chrome.
	   `position: relative` + `overflow: hidden` anchor the grid's ::after solder
	   dots; the band spans full width while its inner block re-caps to the reading
	   measure so the masthead reads like an article header (not edge-to-edge text). */
	.metrics-header {
		position: relative;
		overflow: hidden;
		padding-block: clamp(1.75rem, 4vw, 3rem);
		padding-inline: var(--space-page-x);
		background: var(--manifesto);
		margin-block-end: 1.5rem;
	}
	.metrics-header__inner {
		position: relative;
		z-index: var(--z-content);
		max-width: var(--container-content);
		margin-inline: auto;
	}
	.metrics-corner {
		white-space: nowrap;
	}
	/* The subheading line ("// PROXY…") leads the ArticleShell meta row; it reads
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
	   The rail's own vertical rhythm; the SEC readout sits above the ToC. Below xl
	   the whole left rail is hidden by DetailTemplate (the floating TocPill takes
	   over), so the SEC readout + ToC only appear on the ≥xl sticky rail. */
	.metrics-toc-rail {
		display: none;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	@media (min-width: 1280px) {
		.metrics-toc-rail {
			display: flex;
		}
	}

	/* Re-show the floating ToC pill through the 1024–1279 band (TocPill hides
	   itself ≥lg, but the DetailTemplate left rail only appears at ≥xl). */
	.metrics-toc-pill-shell :global(.toc-pill-container) {
		display: block;
	}
	@media (min-width: 1280px) {
		.metrics-toc-pill-shell :global(.toc-pill-container) {
			display: none;
		}
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
	.metrics-article :global(.detail-mobile-summary .metrics-stat-rail) {
		flex-direction: row;
		flex-wrap: wrap;
	}
	.metrics-article :global(.detail-mobile-summary .metrics-stat) {
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
		gap: 0.4rem;
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
		padding: 0.1rem 0.5rem;
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
		font-size: 0.6875rem;
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
	/* Live pipeline note: a quiet card-inset block, visually set apart from the
	   static science with a left rule + muted surface (NOT --primary, no data
	   mark). The verbatim methodology string reads on the mono caption voice. */
	.metric__note-block {
		padding: 0.75rem 0.875rem;
		border-left: 3px solid var(--border-rule-accent, var(--border));
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
		gap: 0.4rem;
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
		gap: 0.4rem;
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

	/* ── Quiet-mode (focus reading) toggle ─────────────────────────────────────
	   The single header switch, ported 1:1 from the yesid.dev "Quiet mode" control
	   onto transit tokens: a quiet mono pill that lights up in --primary ONLY when
	   active (the wave strokes fade and the core dot glows), so OFF it is calm
	   chrome and ON it reads as a clear, lit state. */
	.metrics-quiet-controls {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-block-start: 0.25rem;
	}
	.metrics-quiet-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 44px;
		padding-inline: 0.875rem 1rem;
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
	.metrics-quiet-toggle:hover,
	.metrics-quiet-toggle:focus-visible,
	.metrics-quiet-toggle[aria-checked='true'] {
		border-color: var(--primary);
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 7%, var(--background));
	}
	.metrics-quiet-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
	.metrics-quiet-toggle .q-wave,
	.metrics-quiet-toggle .q-core {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition:
			opacity var(--duration-normal) var(--ease-default),
			fill var(--duration-normal) var(--ease-default),
			stroke var(--duration-normal) var(--ease-default),
			filter var(--duration-normal) var(--ease-default);
	}
	.metrics-quiet-toggle .q-wave--far {
		opacity: 0.5;
	}
	.metrics-quiet-toggle[aria-checked='true'] .q-wave {
		opacity: 0;
	}
	.metrics-quiet-toggle[aria-checked='true'] .q-core {
		fill: var(--primary);
		stroke: var(--primary);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 60%, transparent));
	}

	/* Remember pin — the paired switch. Same mono-pill chrome as the FOCUS switch
	   but a touch quieter (it is a meta-control over the FOCUS one). Lights up in
	   --primary when engaged (the pin fills). */
	.metrics-quiet-remember {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 44px;
		padding-inline: 0.75rem 0.875rem;
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-md);
		background: var(--background);
		box-shadow: inset 0 1px 0 var(--edge-highlight);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-control);
		letter-spacing: 0;
		cursor: pointer;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default);
	}
	.metrics-quiet-remember:hover,
	.metrics-quiet-remember:focus-visible,
	.metrics-quiet-remember[aria-checked='true'] {
		border-color: var(--primary);
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 7%, var(--background));
	}
	.metrics-quiet-remember:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
	.metrics-quiet-remember .r-pin {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition:
			fill var(--duration-normal) var(--ease-default),
			stroke var(--duration-normal) var(--ease-default),
			filter var(--duration-normal) var(--ease-default);
	}
	.metrics-quiet-remember[aria-checked='true'] .r-pin {
		fill: color-mix(in srgb, var(--primary) 22%, transparent);
		stroke: var(--primary);
		filter: drop-shadow(0 0 3px color-mix(in srgb, var(--glow) 50%, transparent));
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
		.metrics-quiet-toggle,
		.metrics-quiet-toggle .q-wave,
		.metrics-quiet-toggle .q-core,
		.metrics-quiet-remember,
		.metrics-quiet-remember .r-pin {
			transition: none;
		}
	}
</style>
