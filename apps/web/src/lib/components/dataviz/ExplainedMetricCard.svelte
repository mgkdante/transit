<!--
  ExplainedMetricCard — a WIDE, two-column metric card (slice-S6).

  The operator's "top metric card" shape for the lines surface: a metric the
  reader can both GLANCE at and UNDERSTAND in place.

    col1 (figure)  — the (i) explainer affordance + the metric label + the big
                     value (the wayfinding voice via MetricDisplay), plus an
                     optional caveat note (e.g. ramp-in) under the value.
    col2 (text)    — the long, always-visible plain-language explanation, so the
                     reading is not hidden behind a hover.

  Composition, not reinvention: the value + honest-absence live in the shared
  MetricDisplay primitive; this card only adds the card chrome + the explanation
  column. The (i) affordance is passed in as the `info` SNIPPET so this dataviz
  primitive stays free of any feature dependency (the lines surface owns its
  MetricInfo wiring and hands it down) — components never import from features.

  Responsive by CONTAINER, not viewport: each card decides for ITSELF whether the
  explanation sits beside the figure (wide) or stacks beneath it (narrow), so the
  same card reads correctly 1-up on a phone or 4-up in a desktop grid.

  DOCTRINE: this card paints NO data mark (the value's amber wayfinding voice
  lives inside MetricDisplay), so it stays off the affordance tokens entirely —
  quiet card chrome (border + shadow + surface) only. Tokens only, no hex.
-->
<script lang="ts" module>
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';
	import type { Snippet } from 'svelte';

	export interface ExplainedMetricCardProps {
		/** Primary metric label (e.g. "On-time %"). */
		label: string;
		/** Formatted value, or null/"" for the honest no-data state. */
		value: string | null | undefined;
		/**
		 * The long, always-visible plain-language explanation (col2). OPTIONAL: omit it
		 * for a clean single-glance tile (label + value + sublabel + (i) hover only). The
		 * hero snapshot strip drops it so the context lives ONLY in the (i) hover, not
		 * duplicated inline; deep-dive cards (§02) pass it to keep the reading visible.
		 */
		explanation?: string;
		/** The (i) explainer affordance for col1 — passed in by the caller. */
		info?: Snippet;
		/** Optional secondary caption under the value (e.g. a p50/regular reading). */
		sublabel?: string;
		/** Optional caveat note under the figure (e.g. the ramp-in note). */
		note?: string;
		/**
		 * Typed absence reason. With `locale`, a null value renders the styled
		 * honest-absence (AbsentValue: calm tone + glyph + the WHY) via MetricDisplay,
		 * never a bare dot or fabricated 0.
		 */
		absentReason?: AbsenceReasonKey;
		/** Copy params interpolated into the absence WHY (e.g. { first: '06:00' }). */
		absentParams?: Readonly<Record<string, string | number>>;
		/** Locale for the styled absence copy (required for `absentReason`). */
		locale?: Locale;
		/** Plain no-data label fallback when no `absentReason`/`locale` is supplied. */
		emptyLabel?: string;
		/** Value size, threaded to MetricDisplay. */
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';

	let {
		label,
		value,
		explanation,
		info,
		sublabel,
		note,
		absentReason,
		absentParams,
		locale,
		emptyLabel,
		size = 'md',
		class: className,
	}: ExplainedMetricCardProps = $props();
</script>

<article
	class={cn('explained-metric-card', className)}
	data-slot="explained-metric-card"
	data-explained={explanation ? 'true' : 'false'}
>
	<div class="emc-grid">
		<!-- col1 — the label + metric, then the (i) affordance (+ optional caveat note).
		     MetricDisplay comes FIRST in the DOM so the a11y/tab reading order is
		     label → value → (i) → note (the explainer is reached AFTER the figure it
		     annotates); the (i) is pinned to the visual top-right corner via CSS, so
		     DOM order does not change where it appears. -->
		<div class="emc-figure" data-slot="explained-metric-figure">
			<MetricDisplay
				{label}
				{value}
				{sublabel}
				{emptyLabel}
				{absentReason}
				{absentParams}
				{locale}
				{size}
			/>
			{#if info}
				<span class="emc-info" data-slot="explained-metric-info">{@render info()}</span>
			{/if}
			{#if note}
				<p class="emc-note" data-slot="explained-metric-note">{note}</p>
			{/if}
		</div>

		<!-- col2 — the always-visible plain-language explanation. -->
		{#if explanation}
			<p class="emc-explanation" data-slot="explained-metric-text">{explanation}</p>
		{/if}
	</div>
</article>

<style>
	/* Card chrome: the yesid card aesthetic (--card surface, hairline border, soft
	   card shadow) — matches .route-period. container-type lets the card flip its own
	   internal layout off ITS width, never the viewport. No data mark is painted
	   here, so the card stays off the affordance tokens entirely (doctrine-clean). */
	.explained-metric-card {
		position: relative;
		container-type: inline-size;
		/* Fill the grid cell so a row of cards reads as ONE equal-height geometric board
		   (a short "no data" card no longer collapses beside a value+bar card). Flex column
		   so the .emc-grid can eat the slack and pin the content to the top. */
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		box-shadow: var(--shadow-card);
		min-width: 0;
	}

	/* Internal layout: single column (figure over explanation) by default; the
	   figure | explanation 2-up engages once the CARD itself is wide enough. */
	.emc-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		min-width: 0;
		/* Eat the card's slack so short + tall cards occupy the same vertical band. */
		flex: 1;
	}
	/* The 2-up figure | explanation engages ONLY for explained cards. A bare card
	   (no explanation — the hero strip) stays single-column so the figure isn't
	   stranded in a narrow 12rem track beside dead space. */
	@container (min-width: 23rem) {
		.explained-metric-card[data-explained='true'] .emc-grid {
			grid-template-columns: minmax(7rem, 12rem) minmax(0, 1fr);
			gap: 1.25rem 1.75rem;
			align-items: start;
		}
	}

	/* col1 — relative so the (i) can corner-anchor INSIDE the figure (col1), per the
	   "(i) + label + metric" spec, not over the explanation column. */
	.emc-figure {
		position: relative;
		min-width: 0;
		/* Reserve the top-right gutter that clears the ~1.05rem (i) glyph so a long
		   label wraps to its LEFT, never under/over the badge. */
		padding-inline-end: 1.5rem;
	}
	/* The (i) affordance rides col1's top-right corner — an INTERACTIVE control,
	   never a data mark. Pinned absolutely so the label flows past it. */
	.emc-info {
		position: absolute;
		inset-block-start: 0.05rem;
		inset-inline-end: 0;
		display: inline-flex;
	}
	/* The metric label keeps a measure + clears the badge gutter so it wraps cleanly
	   to the left of the corner (i) rather than colliding with it. */
	.emc-figure :global([data-slot='metric-display'] .label-metric) {
		min-width: 0;
		padding-inline-end: 1.4rem;
	}

	/* col2 — the always-visible explanation: readable prose, quiet muted voice. */
	.emc-explanation {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.55;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}

	/* Caveat note (e.g. ramp-in): small, quiet mono under the value. */
	.emc-note {
		margin: 0.375rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
