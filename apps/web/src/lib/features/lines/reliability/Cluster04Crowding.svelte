<!--
  Cluster04Crowding — the 04 CROWDING band of the historic Reliability surface.

  Renders the trailing-window occupancy band-shares as a 100%-stacked proportion
  bar (StackedBar, scale='occupancy'), reusing the dataviz occupancy scale/vars.
  The dominant band is also lifted to a MetricDisplay headline for a single-glance
  read.

  HONESTY DOCTRINE:
    - occupancy_mix is null when there is no telemetry. The VM resolves that (and
      an all-zero mix) to `isEmpty`, and we render an EXPLICIT "no crowding
      telemetry" note — NEVER a fabricated bar or an even split.
    - Every band is a data mark on the dataviz occupancy scale (StackedBar owns
      this); --primary never colours a band.

  Band labels are reused from the canonical `lines` detail copy
  (detailCopy[locale].occupancyBands) so the vocabulary stays DRY across surfaces.
-->
<script lang="ts">
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { StackedBar, type StackedSegment } from '$lib/components/dataviz';
	import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
	import type { Locale } from '$lib/i18n';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { detailCopy } from '../lines.copy';
	import type { CrowdingVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';

	interface Props {
		/** The 04-crowding view-model from `toReliabilityClusters`. */
		vm: CrowdingVM;
		/** Active locale — FR is the canonical product voice. */
		locale: Locale;
		/** The slice-9.6 reliability copy (cluster overline + honest-state notes). */
		copy: ReliabilityCopy;
	}

	let { vm, locale, copy }: Props = $props();

	/** Canonical occupancy band labels (legend + a11y), keyed by OccupancyCode. */
	const bands = $derived(detailCopy[locale].occupancyBands);

	/** The five occupancy bands as StackedBar segments (fractions 0..1). */
	const segments = $derived.by<StackedSegment[]>(() =>
		OCCUPANCY_CODES.map((code: OccupancyCode) => ({
			code,
			value: vm.mix ? vm.mix[code] : null,
			label: bands[code],
		})),
	);

	/** Total band share (guards the dominant-band headline + share math). */
	const total = $derived(
		segments.reduce((sum, s) => sum + (s.value != null && s.value > 0 ? s.value : 0), 0),
	);

	/** The largest band — lifted to a MetricDisplay as the single-glance read. */
	const dominant = $derived.by(() => {
		if (vm.isEmpty || total <= 0) return null;
		let best: { code: OccupancyCode; label: string; share: number } | null = null;
		for (const code of OCCUPANCY_CODES) {
			const v = vm.mix ? vm.mix[code] : null;
			if (v == null || v <= 0) continue;
			if (best == null || v > best.share) best = { code, label: bands[code], share: v };
		}
		return best;
	});

	/** Dominant-band share as a whole-percent string (e.g. "62%"). */
	const dominantPct = $derived(dominant ? `${Math.round((dominant.share / total) * 100)}%` : null);

	// The in-app metric-explainer (i) affordance for the occupancy band: the
	// one-line tip + a localized deep link to /metrics#occupancy. An INTERACTIVE
	// control beside the label, never a data mark.
	const explainerCopy = $derived(metricsCopy[locale]);
	const occupancyInfo = $derived.by(() => {
		const i = metricInfoFor('occupancy', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(copy.clusters.crowding),
			linkLabel: explainerCopy.info.link,
		};
	});
	// The dominant-band tile's own (i): same occupancy tip + deep link, but a
	// distinct aria-label naming THAT band (e.g. "About Crushed") so the trigger
	// beside the headline never collides with the cluster-heading (i) above.
	const dominantInfo = $derived.by(() => {
		const i = metricInfoFor('occupancy', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(dominant?.label ?? copy.clusters.crowding),
			linkLabel: explainerCopy.info.link,
		};
	});
</script>

<section
	class="cluster-band"
	aria-labelledby="cluster04-crowding-label"
	data-slot="cluster-04-crowding"
>
	<span class="label-with-info">
		<SectionLabel id="cluster04-crowding-label" text={copy.clusters.crowding} variant="station" />
		<MetricInfo
			class="cluster-info"
			tip={occupancyInfo.tip}
			href={occupancyInfo.href}
			label={occupancyInfo.label}
			linkLabel={occupancyInfo.linkLabel}
			side="bottom"
		/>
	</span>
	<!-- Window caption: the occupancy mix is a fixed trailing window. -->
	<p class="crowding-window" data-slot="crowding-window">{copy.windows.crowding}</p>

	{#if vm.isEmpty || dominant == null}
		<!-- Honest empty state: no occupancy telemetry → say so, never a fake bar. -->
		<p class="crowding-empty" data-slot="crowding-empty">{copy.strip.noDataNote}</p>
	{:else}
		<div class="crowding-headline-row">
			<MetricDisplay
				value={dominantPct ?? copy.strip.noDataNote}
				label={dominant.label}
				size="lg"
				class="crowding-headline"
			/>
			<MetricInfo
				class="cluster-info"
				tip={dominantInfo.tip}
				href={dominantInfo.href}
				label={dominantInfo.label}
				linkLabel={dominantInfo.linkLabel}
				side="bottom"
			/>
		</div>
		<!-- Interactive: each band's share reveals on hover/focus (#11). -->
		<StackedBar
			scale="occupancy"
			{segments}
			label={copy.clusters.crowding}
			size="sm"
			legend
			interactive
			class="crowding-bar"
		/>
	{/if}
</section>

<style>
	.cluster-band {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3, 0.75rem);
	}
	/* The cluster overline + its explainer (i), kept on the label's baseline. */
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.crowding-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption, 0.8125rem);
		color: var(--muted-foreground);
	}
	/* Window caption: quiet mono, AA both themes. */
	.crowding-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* The dominant-band headline + its explainer (i), kept on the tile's top edge. */
	.crowding-headline-row {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
</style>
