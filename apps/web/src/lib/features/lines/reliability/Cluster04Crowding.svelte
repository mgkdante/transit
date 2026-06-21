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

	/* ── Delay by crowding (G1) ────────────────────────────────────────────────
	   Does crowding correlate with delay? The contract's per-band avg delay, laid
	   out on the FIXED occupancy axis (empty→full) so the reading is consistent and
	   honest about gaps. SPARSE: a band the contract omits, OR a present band whose
	   avg_delay is null, renders the explicit no-data message — NEVER a "·" or a
	   fake 0. Honest per-band absence is the explicit requirement. */
	const fmtMin = (v: number | null | undefined): string | null =>
		v == null ? null : `${v.toFixed(1)} min`;

	// Index the sparse contract cells by band so the fixed-axis lookup is O(1). A
	// plain record (not a Map) keeps this a pure derived value with no reactivity.
	const delayByBand = $derived.by(() => {
		const index: Record<string, (typeof vm.delayByCrowding)[number]> = {};
		for (const cell of vm.delayByCrowding) index[cell.band] = cell;
		return index;
	});

	// The fixed occupancy axis, in natural order (empty→full). Each row resolves to
	// its delay display or the honest no-data message; `present` distinguishes a
	// contract-omitted band from a present-but-null one (both still honest, but the
	// secondary p50 is only meaningful for a present cell).
	const delayRows = $derived(
		OCCUPANCY_CODES.map((code: OccupancyCode) => {
			const cell = delayByBand[code];
			const display = fmtMin(cell?.avg_delay_min);
			return {
				code,
				label: bands[code],
				present: cell != null,
				display: display ?? copy.strip.noData,
				hasDelay: display != null,
				p50: fmtMin(cell?.p50_min),
			};
		}),
	);

	// The delay sub-block has data when ANY band carries a real avg delay.
	const hasDelayByCrowding = $derived(delayRows.some((r) => r.hasDelay));
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

	<!-- Delay by crowding (G1): per-band avg delay on the fixed occupancy axis. Lives
	     with the crowding cluster because it relates delay TO crowding. Rendered
	     independently of the mix empty-state so a route with delay data but no mix
	     still surfaces it. SPARSE: an absent band or a null delay shows the honest
	     no-data message in that cell, never a "·" / fake 0. -->
	<div class="crowding-delay" data-slot="delay-by-crowding">
		<SectionLabel text={copy.delayByCrowding.heading} variant="metric" />
		{#if hasDelayByCrowding}
			<dl class="crowding-delay-grid" aria-label={copy.delayByCrowding.heading}>
				{#each delayRows as row (row.code)}
					<div class="crowding-delay-row" data-slot="delay-by-crowding-row" data-band={row.code}>
						<dt class="crowding-delay-label">{row.label}</dt>
						<dd
							class="crowding-delay-value"
							class:crowding-delay-value--empty={!row.hasDelay}
							data-empty={!row.hasDelay}
						>
							{row.display}{#if row.hasDelay && row.p50}<span class="crowding-delay-p50"
									>{copy.delayByCrowding.typical(row.p50)}</span
								>{/if}
						</dd>
					</div>
				{/each}
			</dl>
		{:else}
			<!-- Entirely absent → ONE honest no-data note, never a fabricated grid. -->
			<p class="crowding-empty" data-slot="delay-by-crowding-empty">{copy.delayByCrowding.empty}</p>
		{/if}
	</div>
</section>

<style>
	.cluster-band {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3, 0.75rem);
	}
	/* The cluster overline + its explainer (i), kept centred on the label. The label
	   keeps a measure (min-width:0) so a long overline wraps cleanly; the (i) wrapper
	   never shrinks (flex:none) so the glyph stays whole beside it. */
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.label-with-info :global([data-slot='section-label']) {
		min-width: 0;
	}
	.label-with-info :global(.cluster-info) {
		flex: none;
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
	/* The dominant-band headline + its explainer (i), kept on the tile's top edge.
	   The tile keeps a measure (min-width:0) so a long band label wraps cleanly; the
	   (i) wrapper never shrinks (flex:none) so the glyph stays whole beside it. */
	.crowding-headline-row {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.crowding-headline-row :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.crowding-headline-row :global(.cluster-info) {
		flex: none;
	}

	/* Delay-by-crowding sub-block: a quiet ranked-by-axis list (band label + its
	   avg delay), seated below the occupancy bar with its own overline. */
	.crowding-delay {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
		margin-top: var(--spacing-3, 0.75rem);
	}
	.crowding-delay-grid {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
	}
	.crowding-delay-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.crowding-delay-label {
		font-size: var(--text-small);
		color: var(--foreground);
		min-width: 0;
	}
	.crowding-delay-value {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	/* Honest no-data reading of a band's delay: quiet muted mono (never a "·"/0). */
	.crowding-delay-value--empty {
		color: var(--muted-foreground);
	}
	.crowding-delay-p50 {
		font-size: var(--text-caption, 0.8125rem);
		color: var(--muted-foreground);
	}
</style>
