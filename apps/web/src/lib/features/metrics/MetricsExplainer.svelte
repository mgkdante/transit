<!--
  MetricsExplainer — the /metrics surface screen (slice-9.6).

  The in-app metric explainer. For every citizen-facing reliability metric it
  renders, grouped by the five reliability clusters: a definition, the math, the
  verbatim Defining SQL, a "what it's NOT" misread warning, and the honest
  caveats — all bilingual (FR canonical). A jump-nav links each metric; a (i)
  tip on the reliability surface deep-links here at each metric's anchor.

  Composes the brand/layout spine only: Surface + SurfaceHeader + SectionLabel +
  SectionHeading. No data load — the content is static (metrics.content.ts).

  DOCTRINE: no data marks here at all (this is prose + SQL), so the dataviz scale
  is not in play; --primary appears only on the SectionHeading flourish dot and
  the interactive jump-nav/back-to-top links (interactive affordances). Honest
  framing is the whole point — the provenance preamble + per-metric caveats carry
  the "proxy, not certified OTP / no AVL / NULL-not-0" doctrine verbatim. AA via
  --muted-foreground; reduced-motion guarded; smooth-scroll disabled under it.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { Surface } from '$lib/components/layout';
	import { SurfaceHeader } from '$lib/components/surface';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { METRICS, METRIC_CLUSTER_ORDER, type MetricEntry } from './metrics.content';
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
</script>

<Surface width="content" class="metrics">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

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

	<!-- Jump-nav (table of contents) — anchored per metric, grouped by cluster. -->
	<nav class="metrics-toc" aria-label={t.tocLabel}>
		<SectionLabel text={t.tocLabel} variant="metric" />
		{#each groups as group (group.cluster)}
			<div class="metrics-toc__group">
				<span class="metrics-toc__overline">{group.label}</span>
				<ul class="metrics-toc__list">
					{#each group.entries as entry (entry.key)}
						<li><a class="metrics-toc__link" href={`#${entry.anchor}`}>{entry.name[locale]}</a></li>
					{/each}
				</ul>
			</div>
		{/each}
	</nav>

	<!-- One section per metric, in cluster order. -->
	{#each groups as group (group.cluster)}
		<div class="metrics-cluster">
			<SectionLabel text={group.label} variant="station" class="metrics-cluster__overline" />
			{#each group.entries as entry (entry.key)}
				<article id={entry.anchor} class="metric">
					<header class="metric__head">
						<SectionHeading heading={entry.name[locale]} level={2} dot />
						<div class="metric__meta">
							<code class="metric__sci">{entry.sciName}</code>
							<span class="metrics-chip metrics-chip--meta">{confidenceMeaning(entry)}</span>
						</div>
					</header>

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
						<!-- Scrollable code region: keyboard-focusable so the overflow is reachable
						     without a pointer (mirrors the dataviz scrollable-region pattern). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<pre
							class="metric__sql"
							tabindex="0"
							role="region"
							aria-label={`${t.sqlAria} — ${entry.sciName}`}><code>{entry.sql}</code></pre>
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
				</article>
			{/each}
		</div>
	{/each}
</Surface>

<style>
	/* Anchored sections clear the sticky TopBar when navigated to. */
	.metric {
		scroll-margin-block-start: 5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding-block: 1.5rem 2rem;
		border-block-start: 1px solid var(--border);
	}
	.metrics-prose {
		scroll-margin-block-start: 5rem;
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

	/* Table of contents. */
	.metrics-toc {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
	}
	.metrics-toc__group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
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
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-toc__link {
		font-size: var(--text-small);
		color: var(--secondary-foreground);
		text-decoration: none;
		transition: color var(--duration-fast) var(--ease-default);
	}
	.metrics-toc__link:hover,
	.metrics-toc__link:focus-visible {
		color: var(--primary);
	}
	.metrics-toc__link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.metrics-cluster {
		display: flex;
		flex-direction: column;
	}
	:global(.metrics-cluster__overline) {
		margin-block-end: 0.5rem;
	}

	.metric__head {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
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
	.metric__sql {
		margin: 0;
		overflow-x: auto;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.6;
		color: var(--foreground);
		white-space: pre;
		tab-size: 2;
	}
	.metric__sql:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.metric__sql code {
		font-family: inherit;
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

	@media (prefers-reduced-motion: reduce) {
		.metrics-toc__link,
		.metric__top {
			transition: none;
		}
	}
</style>
