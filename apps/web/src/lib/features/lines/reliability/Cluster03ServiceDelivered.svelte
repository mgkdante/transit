<!--
  Cluster03ServiceDelivered, the "03 Service delivered" band of the slice-9.6
  historic Reliability surface.

  Reads the `ServiceDeliveredVM` from clusters.ts and surfaces the two RAMP-IN
  reliability metrics the route accrues forward (no historical backfill):

    - cancellations[] → most-recent cancellation_rate_pct (MetricDisplay) + a
      COMPLETENESS bar: the canceled SHARE over the window on a FIXED domain +
      the honest "X of Y trip-days canceled" raw counts.
    - skipped_stops[] → most-recent skipped_stop_rate_pct (MetricDisplay) + the
      same completeness read over skipped / total stop-time updates.

  DOCTRINE upheld here:
    - S7: a flat sparkline of a ~0% rate conveyed nothing (and auto-scaled to the
      in-view max). The completeness bar uses a STABLE absolute domain — the same
      share renders the same length every visit — plus the raw "X of Y" counts the
      bare rate never showed.
    - Every data mark rides the dataviz scale; the share bar uses the "late" amber
      token (a problem-rate reads as the late/amber voice), NEVER --primary.
    - RAMP-IN is shown PROMINENTLY (copy.strip.rampInNote) so an early low number
      is not misread as "good": history accrues forward, no backfill.
    - Honest empty: when a metric has no count totals it says so explicitly
      (the styled AbsentValue chip), never a fabricated 0 and never a dropped section.
    - number | null guarded everywhere; null means "no data", never 0.

  Self-contained: copy + locale are passed in (no module-scope i18n lookup), so
  the band compiles + renders in isolation before it is wired into the surface.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { fmtPct, fmtCount } from '$lib/utils';
	import { MetricDisplay, SectionLabel } from '$lib/components/brand';
	import { AbsentValue } from '$lib/components/edge';
	import { SeverityBar } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { CANCEL_RATE_DOMAIN, SKIPPED_RATE_DOMAIN } from '$lib/features/reliability/shiftGrains';
	import type { ServiceDeliveredVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';

	interface Cluster03ServiceDeliveredProps {
		/** The 03 Service-delivered slice of the cluster view-model. */
		vm: ServiceDeliveredVM;
		/** Active locale (FR canonical), threaded in, not looked up here. */
		locale: Locale;
		/** Co-located reliability copy for the active locale. */
		copy: ReliabilityCopy;
		/**
		 * The grain rail's active-window label (Today / This week / This month / Date
		 * range). §03 is windowed to the selected grain in the mapper, so this caption
		 * tells the reader WHICH window the completeness reflects. Falls back to the
		 * fixed trend-window copy when not threaded (isolated render).
		 */
		windowLabel?: string;
	}

	let { vm, locale, copy, windowLabel }: Cluster03ServiceDeliveredProps = $props();

	// A problem-rate is the late/amber voice on the dataviz scale (never --primary).
	const RATE_VAR = 'var(--dataviz-status-late)';

	/** Format a rate as a percentage, else null (the muted no-data label). */
	const pct = (v: number | null): string | null => fmtPct(v, { rounding: 'fixed1' });

	// S7: a flat sparkline of a ~0% rate conveys nothing (the operator's complaint).
	// Replace it with an honest COMPLETENESS read — the canceled/skipped SHARE over the
	// window on the FIXED absolute % domain (0% reads as an empty bar = good news), PLUS the
	// raw "X of Y" counts the rate alone never showed. The domains are the STRUCTURAL [0,100]
	// percentage scale from the shared module — never an inline per-chart zoom.
	const RATE_SEVERITY: SeverityCode = 'watch';

	// Headline rate = the grain-windowed rate the mapper already computed (the SAME number
	// the snapshot strip shows), so picking Today / week / month moves this tile in lockstep
	// with the strip — never the stuck latest-day rate that used to contradict it.
	const cancellationRatePct = $derived(vm.cancellationRatePct);
	const skippedStopRatePct = $derived(vm.skippedStopRatePct);

	/** Sum a count pair over the window → {part, total, sharePct}; null when none observed. */
	function completeness<T>(
		rows: readonly T[],
		part: (r: T) => number | null | undefined,
		whole: (r: T) => number | null | undefined,
	): { part: number; total: number; sharePct: number } | null {
		let partSum = 0,
			total = 0,
			any = false;
		for (const r of rows) {
			const w = whole(r);
			if (w != null) {
				total += w;
				partSum += part(r) ?? 0;
				any = true;
			}
		}
		return any && total > 0 ? { part: partSum, total, sharePct: (partSum / total) * 100 } : null;
	}

	const cancellation = $derived(
		completeness(
			vm.cancellations,
			(c) => c.canceled_trip_days,
			(c) => c.total_trip_days,
		),
	);
	const skipped = $derived(
		completeness(
			vm.skippedStops,
			(s) => s.skipped_stop_count,
			(s) => s.stop_time_update_count,
		),
	);

	const t = $derived(copy.strip);
	// Grouped thousands separators (locale-aware: "3,975" en / "3 975" fr) so the
	// raw "X of Y" counts read cleanly instead of "3975" / "20189695".
	const num = (v: number): string => fmtCount(v, { locale }) ?? `${v}`;

	// The in-app metric-explainer (i) affordance: the one-line tip + a localized
	// deep link to /metrics#<anchor>. An INTERACTIVE control beside each label.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});
</script>

<section
	class="cluster03"
	data-slot="cluster-03-service-delivered"
	aria-label={copy.clusters.serviceDelivered}
>
	<header class="cluster03-head">
		<SectionLabel text={copy.clusters.serviceDelivered} variant="station" />
		<!-- Window caption: the rate histories cover the most-recent closed days. -->
		<p class="cluster03-window" data-slot="service-window">{windowLabel ?? copy.windows.trend}</p>
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
		<!-- Honest empty: the styled honest-absence chip (says WHY), no fabricated zero / dropped section. -->
		<div data-slot="empty-note">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<div class="cluster03-metrics">
			<!-- Cancellations -->
			<article class="cluster03-metric" data-slot="cancellations">
				<div class="metric-with-info">
					<MetricDisplay
						value={pct(cancellationRatePct)}
						emptyLabel={t.noData}
						absentReason="no-observations"
						{locale}
						label={t.cancellationRatePct}
						size="md"
					/>
					{@render metricInfo('cancellation', t.cancellationRatePct)}
				</div>
				{#if cancellation}
					<div class="cluster03-completeness" data-slot="cancellations-completeness">
						<SeverityBar
							severity={RATE_SEVERITY}
							value={cancellation.sharePct}
							domain={CANCEL_RATE_DOMAIN}
							unit="%"
							colorVar={RATE_VAR}
							label={t.cancellationRatePct}
							interactive
						/>
						<p class="cluster03-fraction">
							{t.cancellationFraction(num(cancellation.part), num(cancellation.total))}
						</p>
					</div>
				{:else}
					<div data-slot="cancellations-empty">
						<AbsentValue variant="block" reason="no-observations" {locale} />
					</div>
				{/if}
			</article>

			<!-- Skipped stops -->
			<article class="cluster03-metric" data-slot="skipped-stops">
				<div class="metric-with-info">
					<MetricDisplay
						value={pct(skippedStopRatePct)}
						emptyLabel={t.noData}
						absentReason="no-observations"
						{locale}
						label={t.skippedStopRatePct}
						size="md"
					/>
					{@render metricInfo('skippedStop', t.skippedStopRatePct)}
				</div>
				{#if skipped}
					<div class="cluster03-completeness" data-slot="skipped-stops-completeness">
						<SeverityBar
							severity={RATE_SEVERITY}
							value={skipped.sharePct}
							domain={SKIPPED_RATE_DOMAIN}
							unit="%"
							colorVar={RATE_VAR}
							label={t.skippedStopRatePct}
							interactive
						/>
						<p class="cluster03-fraction">
							{t.skippedFraction(num(skipped.part), num(skipped.total))}
						</p>
					</div>
				{:else}
					<div data-slot="skipped-stops-empty">
						<AbsentValue variant="block" reason="no-observations" {locale} />
					</div>
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
	/* S7: each metric gets its OWN full-width row (single column at every width) so the
	   rate-history charts have room — no longer two cramped cards squeezed per row. */
	.cluster03-metrics {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: 1fr;
	}
	/* Completeness read: the share bar over the honest "X of Y" raw-count fraction. */
	.cluster03-completeness {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.cluster03-fraction {
		margin: 0;
		font-size: var(--text-caption, 0.8125rem);
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
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
</style>
