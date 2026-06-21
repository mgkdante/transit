<!--
  Cluster03ServiceDelivered, the "03 Service delivered" band of the slice-9.6
  historic Reliability surface.

  Reads the `ServiceDeliveredVM` from clusters.ts and surfaces the two RAMP-IN
  reliability metrics the route accrues forward (no historical backfill):

    - cancellations[] → most-recent cancellation_rate_pct (MetricDisplay) + a
      Sparkline of the rate history.
    - skipped_stops[] → most-recent skipped_stop_rate_pct (MetricDisplay) + a
      Sparkline of the rate history.

  DOCTRINE upheld here:
    - Every data mark rides the dataviz scale, the rate history Sparklines use
      the "late" amber token (a problem-rate reads as the late/amber voice),
      NEVER --primary.
    - RAMP-IN is shown PROMINENTLY (copy.strip.rampInNote) so an early low number
      is not misread as "good": history accrues forward, no backfill.
    - Honest empty: when the band has nothing to draw it says so explicitly
      (copy.strip.noDataNote), never a fabricated 0 and never a dropped section.
      A metric whose rate history is all-null still renders its label with the
      no-data note (the Sparkline draws a baseline gap, not a fake zero line).
    - number | null guarded everywhere; null means "no data", never 0.

  Self-contained: copy + locale are passed in (no module-scope i18n lookup), so
  the band compiles + renders in isolation before it is wired into the surface.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { MetricDisplay, SectionLabel } from '$lib/components/brand';
	import { Sparkline } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { ServiceDeliveredVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';

	interface Cluster03ServiceDeliveredProps {
		/** The 03 Service-delivered slice of the cluster view-model. */
		vm: ServiceDeliveredVM;
		/** Active locale (FR canonical), threaded in, not looked up here. */
		locale: Locale;
		/** Co-located reliability copy for the active locale. */
		copy: ReliabilityCopy;
	}

	let { vm, locale, copy }: Cluster03ServiceDeliveredProps = $props();

	// A problem-rate is the late/amber voice on the dataviz scale (never --primary).
	const RATE_VAR = 'var(--dataviz-status-late)';

	/** Format a rate as a percentage, else null (the muted no-data label). */
	const fmtPct = (v: number | null): string | null => (v == null ? null : `${v.toFixed(1)}%`);

	/**
	 * Most-recent (tail-scan) non-null value of `pick`. The contract arrays run
	 * oldest → newest, so the headline is the last row that actually carries one.
	 */
	function mostRecent<T>(
		rows: readonly T[],
		pick: (row: T) => number | null | undefined,
	): number | null {
		for (let i = rows.length - 1; i >= 0; i--) {
			const v = pick(rows[i]);
			if (v != null) return v;
		}
		return null;
	}

	// Cancellations, most-recent rate + full rate history (null = gap, never 0).
	const cancellationRatePct = $derived(
		mostRecent(vm.cancellations, (c) => c.cancellation_rate_pct),
	);
	const cancellationSeries = $derived<Array<number | null>>(
		vm.cancellations.map((c) => c.cancellation_rate_pct ?? null),
	);
	const hasCancellationHistory = $derived(cancellationSeries.some((v) => v != null));

	// Skipped stops, most-recent rate + full rate history (null = gap, never 0).
	const skippedStopRatePct = $derived(mostRecent(vm.skippedStops, (s) => s.skipped_stop_rate_pct));
	const skippedSeries = $derived<Array<number | null>>(
		vm.skippedStops.map((s) => s.skipped_stop_rate_pct ?? null),
	);
	const hasSkippedHistory = $derived(skippedSeries.some((v) => v != null));

	const t = $derived(copy.strip);
	const cancellationHistoryLabel = $derived(`${t.cancellationRatePct} · ${locale}`);
	const skippedHistoryLabel = $derived(`${t.skippedStopRatePct} · ${locale}`);

	// The in-app metric-explainer (i) affordance: the one-line tip + a localized
	// deep link to /metrics#<anchor>. An INTERACTIVE control beside each label.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// Sparkline axis metadata: a % unit on the value + per-index x-labels (date,
	// else the pipeline grain) for the tooltip heading.
	const cancellationXLabels = $derived(vm.cancellations.map((c) => c.date ?? c.grain ?? ''));
	const skippedXLabels = $derived(vm.skippedStops.map((s) => s.date ?? ''));
</script>

<section
	class="cluster03"
	data-slot="cluster-03-service-delivered"
	aria-label={copy.clusters.serviceDelivered}
>
	<header class="cluster03-head">
		<SectionLabel text={copy.clusters.serviceDelivered} variant="station" />
		<!-- Window caption: the rate histories cover the most-recent closed days. -->
		<p class="cluster03-window" data-slot="service-window">{copy.windows.trend}</p>
		<!-- RAMP-IN is the band's defining caveat → surfaced prominently at the top. -->
		<p class="cluster03-rampin" data-slot="ramp-in-note">{t.rampInNote}</p>
	</header>

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

	{#if vm.isEmpty}
		<!-- Honest empty: no fabricated zero, no dropped section. -->
		<p class="cluster03-empty" data-slot="empty-note">{t.noDataNote}</p>
	{:else}
		<div class="cluster03-metrics">
			<!-- Cancellations -->
			<article class="cluster03-metric" data-slot="cancellations">
				<div class="metric-with-info">
					<MetricDisplay
						value={fmtPct(cancellationRatePct)}
						emptyLabel={t.noData}
						label={t.cancellationRatePct}
						size="md"
					/>
					{@render metricInfo('cancellation', t.cancellationRatePct)}
				</div>
				{#if hasCancellationHistory}
					<Sparkline
						values={cancellationSeries}
						colorVar={RATE_VAR}
						width={160}
						height={36}
						label={cancellationHistoryLabel}
						yAxis={{ label: t.cancellationRatePct, unit: copy.units.pct }}
						xLabels={cancellationXLabels}
						interactive
						readout
						readoutHint={t.trendReadoutHint}
					/>
				{:else}
					<p class="cluster03-metric-empty" data-slot="cancellations-empty">{t.noDataNote}</p>
				{/if}
			</article>

			<!-- Skipped stops -->
			<article class="cluster03-metric" data-slot="skipped-stops">
				<div class="metric-with-info">
					<MetricDisplay
						value={fmtPct(skippedStopRatePct)}
						emptyLabel={t.noData}
						label={t.skippedStopRatePct}
						size="md"
					/>
					{@render metricInfo('skippedStop', t.skippedStopRatePct)}
				</div>
				{#if hasSkippedHistory}
					<Sparkline
						values={skippedSeries}
						colorVar={RATE_VAR}
						width={160}
						height={36}
						label={skippedHistoryLabel}
						yAxis={{ label: t.skippedStopRatePct, unit: copy.units.pct }}
						xLabels={skippedXLabels}
						interactive
						readout
						readoutHint={t.trendReadoutHint}
					/>
				{:else}
					<p class="cluster03-metric-empty" data-slot="skipped-stops-empty">{t.noDataNote}</p>
				{/if}
			</article>
		</div>
	{/if}
</section>

<style>
	.cluster03 {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.cluster03-head {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	/* The ramp-in caveat: quiet mono caption, but always present + legible (AA). */
	.cluster03-rampin {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* Window caption: quiet mono, same register as the ramp-in note. */
	.cluster03-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.cluster03-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--muted-foreground);
	}
	.cluster03-metrics {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: 1fr;
	}
	@media (min-width: 520px) {
		.cluster03-metrics {
			grid-template-columns: repeat(auto-fit, minmax(min(13rem, 100%), 1fr));
		}
	}
	.cluster03-metric {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
	}
	/* A metric tile + its explainer (i), kept on the tile's top edge. The tile keeps
	   a measure (min-width:0) so a long label wraps cleanly; the (i) wrapper never
	   shrinks (flex:none) so the glyph stays whole beside it, never colliding. */
	.metric-with-info {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.metric-with-info :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.metric-with-info :global(.cluster-info) {
		flex: none;
	}
	.cluster03-metric-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
