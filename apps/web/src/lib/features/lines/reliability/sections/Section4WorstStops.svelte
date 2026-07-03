<!--
  §4 Where it's worst — "Where does the delay pile up?"

  The accountability section: the worst-N stops as ONE always-visible lollipop (A13)
  on a FIXED absolute domain (the same value renders the same length on every route /
  grain / refresh). S7-B has two magnitude semantics, picked by the VM's
  weakStopsWindowed flag: WINDOWED reads weak_stops_by_grain (DB-ranked worst-first by
  the not-severe Wilson lower bound) and the bar is the SEVERE-DELAY RATE on
  SEVERE_DOMAIN [0,100] — the rank variable, always >= 0, so a worst-by-rate stop whose
  pooled avg delay is <= 0 still draws an honest bar; FALLBACK (pre-deploy scalar) keeps
  the avg-delay bar on DELAY_POS_DOMAIN. Click a row → that stop's page; the heading
  carries the honest shown/total count.

  This section has NO <Detail> layer: the worst-N selector IS the disclosure — a
  GrainPicker that appears once there's more than a screenful (total > 5) with a 5 / 10 /
  All cap (the windowed slice stores <= 15). The window caption keeps it honest about the
  trailing aggregate the ranking reads.

  Reads ONLY the PunctualityVM's `weakStops` + `weakStopsWindowed`. Honest absence
  throughout: when the selector returns no measured stop (`weakStops.shown === 0`) the
  section degrades to its header + the styled AbsentValue chip (says WHY), never a fake 0.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import CollapsibleSection from './CollapsibleSection.svelte';
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

	// Worst-N selector (S7): a selectable how-many-stops control reusing GrainPicker over a
	// numeric-string union — the active chip is --primary (an interactive control), never a data
	// mark. The windowed weak_stops_by_grain stores <= 15, so the cap is 5 / 10 / All(=15); the
	// scalar fallback can carry more but the heading's shown/total stays honest at the cap.
	const WORST_N_SEGMENTS = $derived<GrainSegment<string>[]>([
		{ key: '5', label: '5' },
		{ key: '10', label: '10' },
		{ key: '15', label: copy.strip.worstNAll },
	]);
	let worstN = $state('10');
	const worstNCount = $derived(Number(worstN));

	// S7-B §4: when the windowed weak_stops_by_grain slice is present, each row carries the
	// severe-rate evidence — a compact, null-guarded tooltip note (severe% · avg min · n). A plain
	// closure (NOT $derived): it is invoked inside the $derived `weakStops` below, which re-runs on
	// copy/locale change, so it always reads the current copy.
	const weakStopNote = (w: {
		severe_pct?: number | null;
		avg_delay_min?: number | null;
		observation_count?: number | null;
	}): string => {
		const n = copy.strip.weakStopNote;
		const parts: string[] = [];
		if (w.severe_pct != null)
			parts.push(`${n.severe} ${Math.round(w.severe_pct)}${copy.units.pct}`);
		if (w.avg_delay_min != null)
			parts.push(`${n.avg} ${Math.round(w.avg_delay_min * 10) / 10}${copy.units.min}`);
		if (w.observation_count != null) parts.push(`${n.samples}=${w.observation_count}`);
		return parts.join(' · ');
	};

	// Worst-N accountability LOLLIPOP (A13) — selectWeakStops owns the rank + the worst-N slice +
	// the spec; rendered via the one <Chart>. WINDOWED: the bar is the severe-delay rate on
	// SEVERE_DOMAIN [0,100] (the rank variable, always >= 0), DB-ranked worst-first by the
	// not-severe Wilson lower bound (preRanked → no re-sort), avg+Wilson+n in the row note.
	// FALLBACK (pre-deploy scalar): avg delay on DELAY_POS_DOMAIN, ranked by avg. Click a row →
	// the stop page; the heading carries the honest shown/total count.
	const weakStops = $derived(
		selectWeakStops(
			punctuality.weakStops,
			worstNCount,
			locale,
			{
				title: copy.strip.weakStopsHeading,
				xLabel: copy.strip.avgDelayMin,
				unit: copy.units.min,
				severeXLabel: copy.strip.severeRateLabel,
				severeUnit: copy.units.pct,
				note: weakStopNote,
				ciLabel: copy.strip.weakStopCi,
				stopHref: (id) => `/stop/${id}`,
			},
			{ preRanked: punctuality.weakStopsWindowed },
		),
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

<CollapsibleSection
	dataSection="worst-stops"
	number={5}
	eyebrow={copy.sections.worstStops.label}
	question={copy.sections.worstStops.question}
>
	{#if weakStops.shown > 0}
		<!-- PRIMARY — the worst-N stops lollipop + the worst-N selector (the disclosure). -->
		<div class="section-primary" data-slot="weak-stops" data-card="primary">
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
</CollapsibleSection>

<style>
	/* Section rhythm: generous BETWEEN-block air (research: within ≤ between), all on the 8px grid.
	   The section shell + header now live in CollapsibleSection; this file styles only its body. */
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
		gap: 0.375rem;
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
