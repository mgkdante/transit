<!--
  SnapshotStrip, the full-bleed SNAPSHOT STRIP (band 00) of the slice-9.6
  historic Reliability surface: the single-glance, ZERO-INTERACTION headline.

  Reads the `SnapshotStripVM` from clusters.ts and renders one row of
  MetricDisplay tiles for the selected grain:

    · On-time %        , period.otp_pct
    · Avg delay (min)  , period.avg_delay_min
    · p90 delay (min)  , period.p90_min
    · Regularity (CoV) , busiest-direction headway CoV, expressed as the CoV
                          value PLUS a plain-language regular/irregular caption
                          (NOT a raw number dump, the caption is the reading).
    · Cancellation %   , most-recent rate (RAMP-IN)
    · Skipped-stop %   , most-recent rate (RAMP-IN)

  DOCTRINE upheld here:
    - Headline numbers ride MetricDisplay; the strip itself paints no data mark,
      so the four-colour doctrine holds trivially (--primary never touches data).
    - Honest states: a null metric renders an explicit "—" no-data tile with the
      noDataNote caption, NEVER a fabricated 0, never a silently dropped tile.
    - RAMP-IN: cancellation + skipped-stop tiles carry an inline ramp-in
      affordance (perMetric flags from the VM) so an early low number is not
      misread as "good", history accrues forward, no backfill.
    - When EVERY headline is null (vm.isEmpty) the strip collapses to a single
      explicit no-data note rather than a wall of em-dashes.

  Self-contained: copy + locale are passed in (no module-scope i18n lookup) so
  the band compiles + renders in isolation before it is wired into the surface.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { MetricDisplay } from '$lib/components/brand';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { SnapshotStripVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';

	interface SnapshotStripProps {
		/** The 00 snapshot-strip slice of the cluster view-model. */
		vm: SnapshotStripVM;
		/** Active locale (FR canonical), threaded in, not looked up here. */
		locale: Locale;
		/** Co-located reliability copy for the active locale. */
		copy: ReliabilityCopy;
	}

	let { vm, locale, copy }: SnapshotStripProps = $props();

	const t = $derived(copy.strip);

	// The in-app metric-explainer (i) affordance for one snapshot tile: the
	// one-line tip + a localized deep link to /metrics#<anchor>. The tile labels
	// here ARE the explainer's metric set (parity is gated in metrics.content.test).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	/** Localized number formatter (FR uses fr-CA grouping/decimal). */
	const nf = $derived(locale === 'fr' ? 'fr-CA' : 'en-CA');

	/** Format a nullable integer-ish percent as "82 %"/"82%" or the honest em-dash. */
	const fmtPct = (v: number | null): string =>
		v == null ? '·' : `${v.toLocaleString(nf)}${locale === 'fr' ? ' %' : '%'}`;

	/** Format a nullable minute delay as "3.2 min" or the honest em-dash. */
	const fmtMin = (v: number | null): string =>
		v == null ? '·' : `${v.toLocaleString(nf, { maximumFractionDigits: 1 })} min`;

	/** Format the headway CoV as a 2-dp ratio, or the honest em-dash. */
	const fmtCov = (v: number | null): string =>
		v == null ? '·' : v.toLocaleString(nf, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	// Plain-language reading of the CoV: a headway coefficient of variation below
	// 0.5 reads as "regular" arrivals; at/above 0.5 the gaps swing wide enough to
	// read as "irregular". This caption, not the raw ratio, is the headline the
	// rider acts on. Null CoV → no caption (the tile shows the no-data note).
	const REGULAR_COV_CEIL = 0.5;
	const regularityCaption = $derived<string | null>(
		vm.headwayRegularityCov == null
			? null
			: vm.headwayRegularityCov < REGULAR_COV_CEIL
				? t.regularity.regular
				: t.regularity.irregular,
	);

	// Per-tile honest-empty flags (null = no data for this metric → "—" + note).
	const otpEmpty = $derived(vm.otpPct == null);
	const avgDelayEmpty = $derived(vm.avgDelayMin == null);
	const p50Empty = $derived(vm.p50Min == null);
	const p90Empty = $derived(vm.p90Min == null);
	const covEmpty = $derived(vm.headwayRegularityCov == null);
	const cancellationEmpty = $derived(vm.cancellationRatePct == null);
	const skippedEmpty = $derived(vm.skippedStopRatePct == null);
</script>

{#snippet tileInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="snapshot-tile__info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}

<section class="snapshot-strip" data-slot="snapshot-strip" aria-label={t.otpPct}>
	{#if vm.isEmpty}
		<!-- Honest empty: no wall of em-dashes, no fabricated zero. -->
		<p class="snapshot-strip__empty" data-slot="empty-note">{t.noDataNote}</p>
	{:else}
		<div class="snapshot-strip__grid">
			<!-- On-time % -->
			<article class="snapshot-tile" data-slot="otp">
				{@render tileInfo('otp', t.otpPct)}
				<MetricDisplay value={fmtPct(vm.otpPct)} label={t.otpPct} size="lg" />
				{#if otpEmpty}
					<p class="snapshot-tile__note" data-slot="otp-empty">{t.noDataNote}</p>
				{/if}
			</article>

			<!-- Avg delay -->
			<article class="snapshot-tile" data-slot="avg-delay">
				{@render tileInfo('avgDelay', t.avgDelayMin)}
				<MetricDisplay value={fmtMin(vm.avgDelayMin)} label={t.avgDelayMin} size="lg" />
				{#if avgDelayEmpty}
					<p class="snapshot-tile__note" data-slot="avg-delay-empty">{t.noDataNote}</p>
				{/if}
			</article>

			<!-- p50 typical delay, daily grain only; honest "—" on week/month. -->
			<article class="snapshot-tile" data-slot="p50">
				{@render tileInfo('p50p90', t.p50Min)}
				<MetricDisplay
					value={fmtMin(vm.p50Min)}
					label={t.p50Min}
					sublabel={t.p50Caption}
					size="lg"
				/>
				{#if p50Empty}
					<p class="snapshot-tile__note" data-slot="p50-empty">{t.noDataNote}</p>
				{/if}
			</article>

			<!-- p90 worst-case delay -->
			<article class="snapshot-tile" data-slot="p90">
				{@render tileInfo('p50p90', t.p90Min)}
				<MetricDisplay
					value={fmtMin(vm.p90Min)}
					label={t.p90Min}
					sublabel={t.p90Caption}
					size="lg"
				/>
				{#if p90Empty}
					<p class="snapshot-tile__note" data-slot="p90-empty">{t.noDataNote}</p>
				{/if}
			</article>

			<!-- Headway regularity, CoV value + plain regular/irregular reading. -->
			<article class="snapshot-tile" data-slot="regularity">
				{@render tileInfo('regularityCov', t.headwayRegularityCov)}
				<MetricDisplay
					value={fmtCov(vm.headwayRegularityCov)}
					label={t.headwayRegularityCov}
					sublabel={regularityCaption ?? undefined}
					size="lg"
				/>
				{#if covEmpty}
					<p class="snapshot-tile__note" data-slot="regularity-empty">{t.noDataNote}</p>
				{/if}
			</article>

			<!-- Cancellation rate (RAMP-IN) -->
			<article class="snapshot-tile" data-slot="cancellation">
				{@render tileInfo('cancellation', t.cancellationRatePct)}
				<MetricDisplay
					value={fmtPct(vm.cancellationRatePct)}
					label={t.cancellationRatePct}
					size="lg"
				/>
				{#if vm.perMetric.cancellationRatePct}
					<p class="snapshot-tile__rampin" data-slot="cancellation-rampin">{t.rampInNote}</p>
				{/if}
				{#if cancellationEmpty}
					<p class="snapshot-tile__note" data-slot="cancellation-empty">{t.noDataNote}</p>
				{/if}
			</article>

			<!-- Skipped-stop rate (RAMP-IN) -->
			<article class="snapshot-tile" data-slot="skipped">
				{@render tileInfo('skippedStop', t.skippedStopRatePct)}
				<MetricDisplay
					value={fmtPct(vm.skippedStopRatePct)}
					label={t.skippedStopRatePct}
					sublabel={t.skippedStopCaption}
					size="lg"
				/>
				{#if vm.perMetric.skippedStopRatePct}
					<p class="snapshot-tile__rampin" data-slot="skipped-rampin">{t.rampInNote}</p>
				{/if}
				{#if skippedEmpty}
					<p class="snapshot-tile__note" data-slot="skipped-empty">{t.noDataNote}</p>
				{/if}
			</article>
		</div>
	{/if}
</section>

<style>
	/* Full-bleed band: edge-to-edge surface that breathes against the hub's
	   bleed gutter (the parent <Surface width="bleed"> owns the page padding). */
	.snapshot-strip {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
	}
	.snapshot-strip__grid {
		display: grid;
		gap: 1.25rem 2rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@media (min-width: 640px) {
		.snapshot-strip__grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (min-width: 1024px) {
		.snapshot-strip__grid {
			grid-template-columns: repeat(7, minmax(0, 1fr));
		}
	}
	.snapshot-tile {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}
	/* The metric-explainer (i) affordance rides the tile's top-right corner, an
	   INTERACTIVE control, never a data mark; doctrine-clean. */
	:global(.snapshot-tile__info) {
		position: absolute;
		inset-block-start: 0;
		inset-inline-end: 0;
	}
	/* Honest no-data caption: quiet mono, always legible (AA both themes). */
	.snapshot-tile__note {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* Ramp-in affordance: a small, always-present caveat under the ramp-in tiles. */
	.snapshot-tile__rampin {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* When the strip is bled (.surface-bleed on its band wrapper), the honest
	   no-data note keeps a reading measure rather than stretching edge-to-edge. */
	.snapshot-strip__empty {
		margin: 0;
		max-width: var(--container-content);
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--muted-foreground);
	}
</style>
