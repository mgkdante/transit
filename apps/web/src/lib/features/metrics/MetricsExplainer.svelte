<!--
  MetricsExplainer — the /metrics surface screen (slice-9.6), blog/project-slug layout.

  The in-app metric explainer. For every citizen-facing reliability metric it
  renders, grouped by the five reliability clusters: a definition, the math, the
  verbatim Defining SQL, a "what it's NOT" misread warning, and the honest
  caveats — all bilingual (FR canonical). A (i) tip on the reliability surface
  deep-links here at each metric's anchor.

  LAYOUT (yesid.dev blog/project-detail pattern, grid recipe #3):
    · DESKTOP (≥lg): two columns — a sticky table-of-contents rail (jump-nav,
      current-section aware via IntersectionObserver) + the main content column.
    · MOBILE (<lg): the ToC collapses to a fixed floating pill that opens the
      jump-nav as a focus-trapped, Esc-dismissible sheet; content full-width.
    · Each metric is a collapsible <details>/<summary> disclosure so the long
      page stays navigable; a ToC link jumps to AND expands its target.

  Composes the brand/layout spine: Surface + SurfaceHeader + SectionLabel +
  SectionHeading + StickyPanel + the shared CodeBlock (SQL syntax chrome).

  DOCTRINE: no data marks here (prose + SQL), so the dataviz scale is not in
  play; --primary appears only on interactive affordances (the SectionHeading
  flourish dot, the jump-nav / back-to-top / pill). Honest framing is the whole
  point — the provenance preamble + per-metric caveats carry the "proxy, not
  certified OTP / no AVL / NULL-not-0" doctrine verbatim. AA via
  --muted-foreground; reduced-motion guarded (no smooth-scroll, no sheet slide).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { getLocale, type Locale } from '$lib/i18n';
	import { Surface } from '$lib/components/layout';
	import { SurfaceHeader } from '$lib/components/surface';
	import StickyPanel from '$lib/components/brand/StickyPanel.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import {
		METRICS,
		METRIC_CLUSTER_ORDER,
		type MetricEntry,
		type MetricKey,
	} from './metrics.content';
	import { metricsCopy } from './metrics.copy';

	const locale: Locale = getLocale();
	const t = $derived(metricsCopy[locale]);

	// Group entries by cluster, preserving the canonical surface cluster order and
	// the in-array metric order within each cluster. Empty clusters are dropped.
	const groups = $derived(
		METRIC_CLUSTER_ORDER.map((cluster) => ({
			cluster,
			label: t.clusters[cluster],
			entries: METRICS.filter((m) => m.cluster === cluster),
		})).filter((g) => g.entries.length > 0),
	);

	const confidenceMeaning = $derived(
		(entry: MetricEntry) => t.confidence.levels[entry.confidence].chip,
	);

	// ── Collapsible disclosures ───────────────────────────────────────────────
	// Every metric section is open by default (the page is a reference; nothing is
	// hidden on first paint). A ToC jump still force-opens its target in case the
	// reader had collapsed it.
	let openState = $state<Record<MetricKey, boolean>>(
		Object.fromEntries(METRICS.map((m) => [m.key, true])) as Record<MetricKey, boolean>,
	);

	// ── Scrollspy (current-section aware ToC) ───────────────────────────────────
	// Cheap IntersectionObserver: the topmost section intersecting the viewport's
	// upper band becomes "current". Pure read → write to $state in the callback
	// (fires outside any reactive read). No-ops gracefully without IO (SSR / old).
	let activeAnchor = $state<string | null>(null);

	$effect(() => {
		if (typeof IntersectionObserver === 'undefined') return;
		const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-metric-section]'));
		if (sections.length === 0) return;

		const visible = new Map<string, number>();
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					const id = (e.target as HTMLElement).id;
					if (e.isIntersecting) visible.set(id, e.intersectionRatio);
					else visible.delete(id);
				}
				// Pick the section nearest the top among those in view; else keep last.
				let top: { id: string; y: number } | null = null;
				for (const id of visible.keys()) {
					const el = document.getElementById(id);
					if (!el) continue;
					const y = el.getBoundingClientRect().top;
					if (top === null || y < top.y) top = { id, y };
				}
				if (top) activeAnchor = top.id;
			},
			// Bias the "active" band to the upper third so the current heading wins.
			{ rootMargin: '-10% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
		);
		for (const s of sections) io.observe(s);
		return () => io.disconnect();
	});

	// ── ToC navigation: jump to AND expand the target ───────────────────────────
	async function jumpTo(anchor: string, key: MetricKey, closeSheet = false): Promise<void> {
		openState[key] = true;
		if (closeSheet) sheetOpen = false;
		await tick(); // let the <details> open before measuring scroll position
		const el = document.getElementById(anchor);
		if (!el) return;
		el.scrollIntoView({
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
			block: 'start',
		});
		// Move focus to the section heading for keyboard/AT continuity.
		const heading = el.querySelector<HTMLElement>('summary');
		heading?.focus();
	}

	// ── Mobile floating-pill sheet (focus-trapped, Esc-dismiss) ─────────────────
	let sheetOpen = $state(false);
	let sheetEl = $state<HTMLElement | null>(null);
	let pillEl = $state<HTMLButtonElement | null>(null);

	async function openSheet(): Promise<void> {
		sheetOpen = true;
		await tick();
		// Focus the first focusable inside the sheet (the close button).
		sheetEl?.querySelector<HTMLElement>('button, a')?.focus();
	}

	function closeSheet(returnFocus = true): void {
		sheetOpen = false;
		if (returnFocus) pillEl?.focus();
	}

	function onSheetKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.stopPropagation();
			closeSheet();
			return;
		}
		if (event.key !== 'Tab' || !sheetEl) return;
		// Simple focus trap: wrap Tab/Shift+Tab within the sheet's focusables.
		const focusables = Array.from(
			sheetEl.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'),
		).filter((el) => !el.hasAttribute('disabled'));
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<Surface width="wide" class="metrics">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

	<div class="metrics-layout">
		<!-- ── Sticky ToC rail (desktop) ─────────────────────────────────────── -->
		<div class="metrics-rail">
			<StickyPanel top="5.5rem" class="metrics-rail__panel">
				<nav class="metrics-toc" aria-label={t.tocLabel}>
					<SectionLabel text={t.tocLabel} variant="metric" class="metrics-toc__heading" />
					{#each groups as group (group.cluster)}
						<div class="metrics-toc__group">
							<span class="metrics-toc__overline">{group.label}</span>
							<ul class="metrics-toc__list">
								{#each group.entries as entry (entry.key)}
									<li>
										<a
											class="metrics-toc__link"
											href={`#${entry.anchor}`}
											aria-current={activeAnchor === entry.anchor ? 'true' : undefined}
											onclick={(e) => {
												e.preventDefault();
												jumpTo(entry.anchor, entry.key);
											}}>{entry.name[locale]}</a
										>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</nav>
			</StickyPanel>
		</div>

		<!-- ── Main content column ───────────────────────────────────────────── -->
		<div class="metrics-content">
			<!-- Provenance preamble — the honest framing every number inherits. -->
			<section class="metrics-prose" aria-labelledby="metrics-provenance">
				<SectionLabel id="metrics-provenance" text={t.provenance.label} variant="station" />
				<p class="metrics-preamble">{t.provenance.body}</p>
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

			<!-- One collapsible section per metric, in cluster order. -->
			{#each groups as group (group.cluster)}
				<div class="metrics-cluster">
					<SectionLabel text={group.label} variant="station" class="metrics-cluster__overline" />
					{#each group.entries as entry (entry.key)}
						<details
							id={entry.anchor}
							data-metric-section
							class="metric"
							bind:open={openState[entry.key]}
						>
							<summary class="metric__summary">
								<span class="metric__summary-text">
									<SectionHeading heading={entry.name[locale]} level={2} dot />
									<span class="metric__meta">
										<code class="metric__sci">{entry.sciName}</code>
										<span class="metrics-chip metrics-chip--meta">{confidenceMeaning(entry)}</span>
									</span>
								</span>
								<span class="metric__chevron" aria-hidden="true"></span>
							</summary>

							<div class="metric__body">
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

								<a class="metric__top" href="#metrics-provenance">{t.backToTop}</a>
							</div>
						</details>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</Surface>

<!-- ── Mobile floating-pill ToC (hidden ≥lg) ──────────────────────────────── -->
<button
	bind:this={pillEl}
	type="button"
	class="metrics-pill"
	aria-haspopup="dialog"
	aria-expanded={sheetOpen}
	onclick={openSheet}
>
	<span class="metrics-pill__glyph" aria-hidden="true"></span>
	{t.tocPill.open}
</button>

{#if sheetOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="metrics-sheet__scrim" onclick={() => closeSheet()}></div>
	<div
		bind:this={sheetEl}
		class="metrics-sheet"
		role="dialog"
		aria-modal="true"
		aria-label={t.tocPill.title}
		tabindex="-1"
		onkeydown={onSheetKeydown}
	>
		<div class="metrics-sheet__head">
			<SectionLabel text={t.tocPill.title} variant="metric" />
			<button
				type="button"
				class="metrics-sheet__close"
				aria-label={t.tocPill.close}
				onclick={() => closeSheet()}
			>
				<span aria-hidden="true">&times;</span>
			</button>
		</div>
		<nav class="metrics-toc metrics-toc--sheet" aria-label={t.tocPill.title}>
			{#each groups as group (group.cluster)}
				<div class="metrics-toc__group">
					<span class="metrics-toc__overline">{group.label}</span>
					<ul class="metrics-toc__list metrics-toc__list--sheet">
						{#each group.entries as entry (entry.key)}
							<li>
								<a
									class="metrics-toc__link"
									href={`#${entry.anchor}`}
									aria-current={activeAnchor === entry.anchor ? 'true' : undefined}
									onclick={(e) => {
										e.preventDefault();
										jumpTo(entry.anchor, entry.key, true);
									}}>{entry.name[locale]}</a
								>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>
	</div>
{/if}

<style>
	/* Two-column blog/project layout: sticky rail + content. Single column
	   below the documented lg breakpoint (1024px); the rail is replaced by the
	   floating pill + sheet there. */
	.metrics-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.75rem, 4vw, 2.75rem);
	}
	@media (min-width: 1024px) {
		.metrics-layout {
			grid-template-columns: minmax(14rem, 16rem) minmax(0, 1fr);
			align-items: start;
		}
	}

	/* The rail itself is hidden below lg (floating pill takes over). */
	.metrics-rail {
		display: none;
	}
	@media (min-width: 1024px) {
		.metrics-rail {
			display: block;
		}
	}
	:global(.metrics-rail__panel) {
		padding: 1rem 1.1rem;
	}

	.metrics-content {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
		min-width: 0;
	}

	/* ── Provenance preamble ──────────────────────────────────────────────── */
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
	/* The confidence chip — a quiet, muted pill (NOT a data mark, NOT --primary). */
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
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.metrics-chip--meta {
		font-size: 0.6875rem;
	}

	/* ── Table of contents (rail + sheet) ─────────────────────────────────── */
	.metrics-toc {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	:global(.metrics-toc__heading) {
		display: block;
	}
	.metrics-toc__group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.metrics-toc__overline {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent-text);
	}
	.metrics-toc__list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-toc__list--sheet {
		gap: 0.5rem;
	}
	.metrics-toc__link {
		display: block;
		padding: 0.15rem 0;
		font-size: var(--text-small);
		color: var(--secondary-foreground);
		text-decoration: none;
		border-inline-start: 2px solid transparent;
		padding-inline-start: 0.625rem;
		margin-inline-start: -0.625rem;
		transition: color var(--duration-fast) var(--ease-default);
	}
	.metrics-toc__link:hover,
	.metrics-toc__link:focus-visible {
		color: var(--primary);
	}
	.metrics-toc__link[aria-current='true'] {
		color: var(--primary);
		border-inline-start-color: var(--primary);
	}
	.metrics-toc__link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	/* ── Metric disclosures ───────────────────────────────────────────────── */
	.metrics-cluster {
		display: flex;
		flex-direction: column;
	}
	:global(.metrics-cluster__overline) {
		margin-block-end: 0.5rem;
	}

	.metric {
		scroll-margin-block-start: 5.5rem;
		border-block-start: 1px solid var(--border);
	}
	.metric__summary {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding-block: 1.5rem 0.75rem;
		cursor: pointer;
		list-style: none;
	}
	.metric__summary::-webkit-details-marker {
		display: none;
	}
	.metric__summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius);
	}
	.metric__summary-text {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	/* The display heading inside the summary keeps the section-heading flourish
	   but tightens its trailing margin (the disclosure body provides the gap). */
	.metric__summary-text :global(.section-heading-text) {
		font-size: clamp(1.5rem, 4vw, 2rem);
		margin-block-end: 0;
	}
	.metric__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.metric__sci {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	/* Disclosure chevron — a muted glyph that rotates on open (interactive). */
	.metric__chevron {
		flex-shrink: 0;
		inline-size: 0.6rem;
		block-size: 0.6rem;
		margin-block-start: 0.5rem;
		border-inline-end: 2px solid var(--muted-foreground);
		border-block-end: 2px solid var(--muted-foreground);
		transform: rotate(-45deg);
		transition: transform var(--duration-fast) var(--ease-default);
	}
	.metric[open] .metric__chevron {
		transform: rotate(45deg);
	}

	.metric__body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding-block-end: 2rem;
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
	.metric__top {
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: 0.04em;
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

	/* ── Mobile floating pill + sheet ─────────────────────────────────────── */
	.metrics-pill {
		position: fixed;
		inset-block-end: 1.25rem;
		inset-inline-end: 1.25rem;
		z-index: var(--z-menu);
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--popover);
		color: var(--popover-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		box-shadow: var(--shadow-card);
		cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-default);
	}
	.metrics-pill:hover,
	.metrics-pill:focus-visible {
		border-color: var(--primary);
		color: var(--primary);
	}
	.metrics-pill:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.metrics-pill__glyph {
		display: inline-block;
		inline-size: 0.85rem;
		block-size: 0.7rem;
		border-block-start: 2px solid currentcolor;
		border-block-end: 2px solid currentcolor;
		position: relative;
	}
	.metrics-pill__glyph::before {
		content: '';
		position: absolute;
		inset-inline: 0;
		inset-block-start: 50%;
		transform: translateY(-1px);
		border-block-start: 2px solid currentcolor;
	}
	@media (min-width: 1024px) {
		.metrics-pill {
			display: none;
		}
	}

	.metrics-sheet__scrim {
		position: fixed;
		inset: 0;
		z-index: var(--z-sheet);
		background: rgb(0 0 0 / 0.5);
		animation: metrics-scrim-in var(--duration-fast) var(--ease-out);
	}
	.metrics-sheet {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: var(--z-menu);
		max-block-size: 80dvh;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem var(--space-page-x) calc(1.25rem + env(safe-area-inset-bottom, 0px));
		border-block-start: 1px solid var(--border);
		border-start-start-radius: var(--radius-lg);
		border-start-end-radius: var(--radius-lg);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-sheet);
		overflow-y: auto;
		animation: metrics-sheet-in var(--duration-normal) var(--ease-out);
	}
	@media (min-width: 1024px) {
		.metrics-sheet,
		.metrics-sheet__scrim {
			display: none;
		}
	}
	.metrics-sheet__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.metrics-sheet__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2rem;
		block-size: 2rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: transparent;
		color: var(--muted-foreground);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default);
	}
	.metrics-sheet__close:hover,
	.metrics-sheet__close:focus-visible {
		color: var(--primary);
		border-color: var(--primary);
	}
	.metrics-sheet__close:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	@keyframes metrics-scrim-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes metrics-sheet-in {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.metrics-toc__link,
		.metric__top,
		.metric__chevron,
		.metrics-pill,
		.metrics-sheet__close {
			transition: none;
		}
		.metrics-sheet,
		.metrics-sheet__scrim {
			animation: none;
		}
	}
</style>
