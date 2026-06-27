<!--
  §4 Where it's worst — "Where does the delay pile up?"

  The accountability section: the worst-N stops ranked worst-delay first as ONE
  always-visible lollipop (A13) on the FIXED DELAY_POS_DOMAIN (the same delay
  renders the same length on every route / grain / refresh). Click a row → that
  stop's page. The honest heading carries the shown/total count.

  This section has NO <Detail> layer: the worst-N selector IS the disclosure — a
  GrainPicker that appears once there's more than a screenful (total > 5) and lets
  the rider widen the lens (5 → 100). The window caption keeps it honest about the
  trailing aggregate the ranking reads.

  Reads ONLY the PunctualityVM's `weakStops`. Honest absence throughout: when the
  selector returns no measured stop (`weakStops.shown === 0`) the section degrades
  to its header + the styled AbsentValue chip (says WHY), never a fabricated 0.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import { Chart } from '$lib/components/dataviz/chart';
	import { GrainPicker, type GrainSegment } from '$lib/components/surface';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { selectWeakStops } from '../selectors/weakStops';
	import type { PunctualityVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';

	interface Section4WorstStopsProps {
		/** The punctuality view-model from `toReliabilityClusters` — only `weakStops` is read. */
		punctuality: PunctualityVM;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The co-located reliability copy bundle for this locale. */
		copy: ReliabilityCopy;
	}
	let { punctuality, locale, copy }: Section4WorstStopsProps = $props();

	// Metric-explainer (i) affordance — the same wiring every section uses.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// Worst-N selector (S7): a selectable how-many-stops control (5/10/20/30/50/100,
	// default 10) reusing GrainPicker over a numeric-string union — the active chip is
	// --primary (an interactive control), never a data mark. Local state; the slice is
	// applied below so the data is always present, just truncated to the chosen N.
	const WORST_N_SEGMENTS: GrainSegment<string>[] = [
		{ key: '5', label: '5' },
		{ key: '10', label: '10' },
		{ key: '20', label: '20' },
		{ key: '30', label: '30' },
		{ key: '50', label: '50' },
		{ key: '100', label: '100' },
	];
	let worstN = $state('10');
	const worstNCount = $derived(Number(worstN));

	// Worst-N accountability LOLLIPOP (A13) — selectWeakStops owns the rank + the worst-N
	// slice + the spec; rendered via the one <Chart> on the fixed DELAY_POS_DOMAIN (the same
	// delay renders the same length on every route/grain/refresh). Click a row → the stop
	// page. The heading carries the honest shown/total count. (Ranking is by avg delay today
	// — the contract WeakStop carries no Wilson/n; the Wilson-lower rank + whisker is a small
	// pipeline-rollup follow-up.)
	const weakStops = $derived(
		selectWeakStops(punctuality.weakStops, worstNCount, locale, {
			title: copy.strip.weakStopsHeading,
			xLabel: copy.strip.avgDelayMin,
			unit: copy.units.min,
			stopHref: (id) => `/stop/${id}`,
		}),
	);
	const weakStopsHeading = $derived(
		weakStops.total > weakStops.shown
			? `${copy.strip.weakStopsHeading} · ${weakStops.shown}/${weakStops.total}`
			: `${copy.strip.weakStopsHeading} · ${weakStops.shown}`,
	);
</script>

{#snippet metricInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="cluster-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}

<section class="section" data-section="worst-stops" aria-label={copy.sections.worstStops.label}>
	<header class="section-head">
		<SectionLabel text={copy.sections.worstStops.label} variant="station" />
		<p class="section-question" data-slot="section-question">
			{copy.sections.worstStops.question}
		</p>
	</header>

	{#if weakStops.shown > 0}
		<!-- PRIMARY — the worst-N stops lollipop + the worst-N selector (the disclosure). -->
		<div class="section-primary" data-slot="weak-stops">
			<div class="weak-stops-head">
				<span class="label-with-info">
					<SectionLabel text={weakStopsHeading} variant="metric" />
					{@render metricInfo('weakStops', copy.strip.weakStopsHeading)}
				</span>
				{#if weakStops.total > 5}
					<GrainPicker
						segments={WORST_N_SEGMENTS}
						bind:value={worstN}
						label={copy.strip.worstNLabel}
					/>
				{/if}
			</div>
			<p class="caption" data-slot="weak-stops-window">{copy.windows.weakStops}</p>
			<div data-slot="weak-stops-list">
				<Chart spec={weakStops.spec} />
			</div>
		</div>
	{:else}
		<!-- Whole-section honest empty: the selector returned no measured stop. -->
		<div data-slot="worst-stops-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{/if}
</section>

<style>
	/* Section rhythm: generous BETWEEN-block air (research: within ≤ between), all on
	   the 8px grid. The section owns its inner stack; the orchestrator owns the
	   between-section gap. */
	.section {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 3vw, 2rem);
		width: 100%;
	}
	.section-head {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-primary {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	/* Weak-stops heading row: the label + (i) on the left, the worst-N selector on
	   the right; wraps to its own row on narrow/mobile so the selector never crowds
	   the heading. */
	.weak-stops-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.label-with-info :global([data-slot='section-label']) {
		min-width: 0;
	}
	.label-with-info :global(.cluster-info) {
		flex: none;
	}
	/* Quiet mono caption (window label), AA both themes. */
	.caption {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
