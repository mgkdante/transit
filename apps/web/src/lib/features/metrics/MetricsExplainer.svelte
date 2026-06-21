<!--
  MetricsExplainer: the /metrics surface screen (slice-9.6).

  The in-app metric explainer. For every citizen-facing reliability metric it
  renders, grouped by the five reliability clusters: a definition, the math, the
  verbatim Defining SQL, a "what it's NOT" misread warning, and the honest
  caveats, all bilingual (FR canonical). A (i) tip on the reliability surface
  deep-links here at each metric's anchor.

  SHELL: built 1:1 on the yesid.dev blog/project detail-page shell (the SAME
  shared components, on transit tokens + i18n; we are one brand, not lookalikes):

    · A two-column CSS-grid body that is FULL-BLEED within the content area
      (`.body-grid.surface-bleed` escapes the page gutter out to the rail-inset
      <main> edges; it never sits behind the left rail and is never artificially
      narrow). Below the lg breakpoint it collapses to one column.
    · DESKTOP (>=lg): a sticky, collapsible table-of-contents rail (shared TocNav,
      which itself wraps a CollapsibleSection) on the left + the content column on
      the right. The rail tracks the current section (activeId) and scrolls to its
      target on click.
    · The provenance preamble + one CollapsibleSection card PER METRIC (number
      badge, `data-toc` anchor, deep-link `id` on the section block) carry the
      definition / math / SQL / "what it's NOT" / caveats.
    · MOBILE (<lg): the shared TocPill floating pill + drawer drives the same
      activeId/onNavigate.
    · ONE IntersectionObserver (observeActiveToc over `[data-toc]`) owns activeId
      and feeds BOTH the rail and the pill (no duplicate observers).

  Composes the brand/layout spine: Surface + SurfaceHeader + SectionLabel + the
  shared CodeBlock (SQL syntax chrome) + the shared shared/ TOC + collapsible-card
  kit (CollapsibleSection / TocNav / TocPill / toc.ts).

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
	import { getProvenance } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { Surface } from '$lib/components/layout';
	import { SurfaceHeader, ConformanceBadge } from '$lib/components/surface';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
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

	const locale: Locale = getLocale();
	const t = $derived(metricsCopy[locale]);

	// Stable, locale-free anchor for the structural-gaps ("Lacunes") card. It is a
	// non-metric section, so it carries an icon badge (not the continuous metric
	// number) and sits after the metric clusters; the same anchor is its element id,
	// its data-toc hook, and its ToC entry id.
	const LACUNES_ANCHOR = 'structural-gaps';

	// Honesty layer — the active provider's feed-conformance verdict. Supplementary
	// (the badge renders nothing when conformance is null / the fetch fails), so it
	// never blocks the static methodology article.
	const provenance = createResource(() => getProvenance());

	// The supplementary provenance fetch errored (or settled with nothing), so the
	// live conformance badge cannot render. The static methodology + the structural-
	// gaps card always render regardless; this only swaps the live badge for an
	// honest, localized "verdict unavailable" stand-down line (never a blank gap, never
	// a thrown error). Only after the resource has settled, so it never flashes mid-load.
	const provenanceUnavailable = $derived(
		provenance.settled && !provenance.data?.conformance && provenance.error != null,
	);

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

	// ── Active-section tracking ────────────────────────────────────────────────
	// One IntersectionObserver over the section cards' [data-toc] anchors owns the
	// active id; the desktop rail and the mobile pill both receive it as a prop (no
	// duplicate observers). No-ops gracefully without IO (SSR / tests).
	let activeId = $state('');
	onMount(() => observeActiveToc((id) => (activeId = id)));

	// ── TOC navigation ──────────────────────────────────────────────────────────
	// A TOC click scrolls to its section card (1:1 with the yesid detail pages,
	// whose CollapsibleSection scrollToHeading just scrolls). Cards open by default
	// and persist their open-state per sectionKey across a locale switch, so a jump
	// lands on already-open content. await tick() keeps the scroll a frame after any
	// reactive open settles. Reduced-motion drops the smooth scroll.
	async function navigate(id: string): Promise<void> {
		await tick();
		tocElement(id)?.scrollIntoView({
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
			block: 'start',
		});
	}
</script>

<Surface width="wide" class="metrics">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

	<!-- Body: shared detail-page grid (sticky TOC rail | section cards), full-bleed
	     within the content area (surface-bleed escapes the page gutter, never the
	     rail). Single column below lg; the rail is replaced by the floating pill. -->
	<div class="body-grid surface-bleed">
		<aside class="context-column">
			<div class="context-panel toc-scroll">
				<div class="toc-nav-shell">
					<TocNav
						entries={tocEntries}
						{activeId}
						onNavigate={navigate}
						heading={t.tocLabel}
						sectionKey="metrics-toc"
						counterPrefix={t.tocCounterPrefix}
					/>
				</div>
			</div>
		</aside>

		<div class="sections-column" data-testid="metrics-sections">
			<!-- Provenance preamble: the honest framing every number inherits. Carries
			     the data-toc anchor so it is the FIRST tracked ToC target (active-section
			     observer + click-to-scroll), mirroring the structural-gaps card pattern. -->
			<section
				class="metrics-prose"
				aria-labelledby="metrics-provenance"
				data-toc={PROVENANCE_ANCHOR}
			>
				<SectionLabel id="metrics-provenance" text={t.provenance.label} variant="station" />
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
					<SectionLabel text={group.label} variant="station" class="metrics-cluster__overline" />
					{#each group.entries as entry (entry.key)}
						{@const metricIndex = orderedMetrics.findIndex((m) => m.key === entry.key)}
						{@const note = methodologyNote(entry)}
						<div class="section-block" id={entry.anchor}>
							<CollapsibleSection
								title={entry.name[locale]}
								sectionKey={`metrics-${entry.key}`}
								anchor={entry.anchor}
								index={metricIndex}
								open={true}
							>
								<div class="metric__body">
									<p class="metric__meta">
										<code class="metric__sci">{entry.sciName}</code>
										<span class="metrics-chip metrics-chip--meta">{confidenceMeaning(entry)}</span>
									</p>

									<div class="metric__block">
										<SectionLabel text={t.sections.definition} variant="metric" />
										<p class="metric__prose">{entry.definition[locale]}</p>
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
										<p class="metric__prose metric__not">{entry.notReally[locale]}</p>
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

			<!-- Structural gaps ("Lacunes"): the honest close — what these metrics
			     CANNOT tell the rider. Same collapsible-card spine as the methodology
			     sections, but an icon badge (not a metric number) marks it as a
			     non-metric section; carries the deep-link target id + data-toc anchor. -->
			<div class="section-block metrics-lacunes" id={LACUNES_ANCHOR}>
				<CollapsibleSection
					title={t.lacunes.title}
					sectionKey="metrics-lacunes"
					anchor={LACUNES_ANCHOR}
					open={true}
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
	</div>
</Surface>

<!-- Mobile floating TOC pill (hidden ≥lg) -->
<TocPill entries={tocEntries} {activeId} openAria={t.tocPill.open} closeAria={t.tocPill.close} />

<style>
	/* ── Shared detail-page body grid ──────────────────────────────────────────
	   Mirrors the yesid blog/project detail body grid: one column on mobile, a
	   sticky TOC rail + content column at lg. The wrapper is `.surface-bleed`, so
	   inside a `Surface width="wide"` it escapes the page gutter out to the rail-
	   inset <main> edges (full-bleed within the content area, never behind the
	   rail). */
	.body-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		min-width: 0;
		overflow-x: clip;
		/* Re-apply the gutter the surface-bleed escaped, so the content keeps the
		   page padding line as its edge (matches .surface-measure's intent). */
		padding-inline: var(--space-page-x);
	}

	.context-column,
	.sections-column {
		min-width: 0;
	}

	/* The TOC rail is hidden below lg (the floating pill takes over). */
	.toc-nav-shell {
		display: none;
	}

	.sections-column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
	}

	@media (min-width: 1024px) {
		.body-grid {
			grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
			padding-block: 0.5rem;
		}

		.context-column {
			grid-column: 1;
		}

		.sections-column {
			grid-column: 2;
		}

		.context-panel {
			position: sticky;
			top: 5.5rem;
		}

		.toc-nav-shell {
			display: block;
		}

		/* Keep a long TOC scrollable within the sticky viewport (the content column
		   is the longer one). */
		.toc-scroll {
			max-height: calc(100dvh - 7rem);
			overflow-y: auto;
			overscroll-behavior: contain;
			padding-bottom: 1rem;
		}
	}

	/* ── Provenance preamble ─────────────────────────────────────────────────── */
	.metrics-prose {
		scroll-margin-block-start: 5.5rem;
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

	/* The section block carries the deep-link target id (so /metrics#otp scrolls
	   here natively) and offsets the sticky-header scroll landing. */
	.section-block {
		scroll-margin-block-start: 5.5rem;
	}

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

	.metric__top {
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--primary);
		text-decoration: none;
		transition: opacity var(--duration-fast) var(--ease-default);
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
		.metric__top {
			transition: none;
		}
	}
</style>
