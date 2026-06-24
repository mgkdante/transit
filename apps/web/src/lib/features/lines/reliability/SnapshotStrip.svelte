<!--
  SnapshotStrip, the TOP METRIC CARDS (band 00) of the historic Reliability
  surface: the single-glance, ZERO-INTERACTION headline for one line.

  Redesigned in slice-S6 from a compact tile strip into the operator's wide
  two-column "explained" cards (ExplainedMetricCard): each card pairs col1 — the
  (i) explainer + the label + the big value — with col2, an always-visible
  plain-language explanation (the metric's one-liner), so the reading is never
  hidden behind a hover. The seven metrics group into two rows:

    Row 1 (headline rates)   · On-time %   · Avg delay
                             · Cancellation %  · Skipped-stop %   (RAMP-IN ×2)
    Row 2 (delay shape)      · Headway regularity (CoV)
                             · Worst-case (p90)   · Typical (p50)

  DOCTRINE upheld here:
    - Values ride MetricDisplay (inside the card); the strip paints no data mark,
      so the four-colour doctrine holds (--primary never touches data).
    - Honest states: a null metric routes through the shared honest-absence layer
      (AbsentValue, says WHY), NEVER a fabricated 0 or a silently dropped card.
    - RAMP-IN: the cancellation + skipped-stop cards carry the ramp-in note
      (perMetric flags) so an early low number is not misread as "good".
    - When EVERY headline is null (vm.isEmpty) the strip collapses to a single
      styled honest-absence note rather than a wall of empties.

  Self-contained: copy + locale are passed in (no module-scope i18n lookup) so
  the band compiles + renders in isolation before it is wired into the surface.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin as sharedFmtDelayMin, fmtPct as sharedFmtPct } from '$lib/utils';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import { AbsentValue } from '$lib/components/edge';
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

	// The in-app metric-explainer (i) affordance for one card: the one-line tip + a
	// localized deep link to /metrics#<anchor>. The SAME one-liner (`tip`) is what
	// each card shows inline in col2 (the visible explanation), with the (i) adding
	// the deep link to the full methodology. The card labels here ARE the
	// explainer's metric set (parity is gated in metrics.content.test).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	/** Localized number formatter (FR uses fr-CA grouping/decimal). */
	const nf = $derived(locale === 'fr' ? 'fr-CA' : 'en-CA');

	/** Format a nullable integer-ish percent as "82 %"/"82%", else null (no-data). */
	const fmtPct = (v: number | null): string | null =>
		sharedFmtPct(v, { locale, suffix: locale === 'fr' ? ' %' : '%' });

	/** Format a nullable minute delay as "3.2 min", else null (no-data). */
	const fmtMin = (v: number | null): string | null =>
		sharedFmtDelayMin(v, { rounding: 'auto', locale });

	/** Format the headway CoV as a 2-dp ratio, else null (no-data). */
	const fmtCov = (v: number | null): string | null =>
		v == null ? null : v.toLocaleString(nf, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	// Plain-language reading of the CoV: a headway coefficient of variation below
	// 0.5 reads as "regular" arrivals; at/above 0.5 the gaps swing wide enough to
	// read as "irregular". This caption rides the card's sublabel. Null CoV → no
	// caption (the card shows the honest no-data state).
	const REGULAR_COV_CEIL = 0.5;
	const regularityCaption = $derived<string | null>(
		vm.headwayRegularityCov == null
			? null
			: vm.headwayRegularityCov < REGULAR_COV_CEIL
				? t.regularity.regular
				: t.regularity.irregular,
	);
</script>

<!-- Shared (i) affordance: forwards a metric key + label to a MetricInfo popover. -->
{#snippet cardInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
{/snippet}

<!-- Per-card zero-arg (i) snippets — ExplainedMetricCard renders the affordance
     inside col1 via its `info` slot, so each card needs its own argless wrapper. -->
{#snippet otpInfo()}{@render cardInfo('otp', t.otpPct)}{/snippet}
{#snippet avgInfo()}{@render cardInfo('avgDelay', t.avgDelayMin)}{/snippet}
{#snippet cancellationInfo()}{@render cardInfo('cancellation', t.cancellationRatePct)}{/snippet}
{#snippet skippedInfo()}{@render cardInfo('skippedStop', t.skippedStopRatePct)}{/snippet}
{#snippet regularityInfo()}{@render cardInfo('regularityCov', t.headwayRegularityCov)}{/snippet}
{#snippet p90Info()}{@render cardInfo('p50p90', t.p90Min)}{/snippet}
{#snippet p50Info()}{@render cardInfo('p50p90', t.p50Min)}{/snippet}

<section class="snapshot-strip" data-slot="snapshot-strip">
	{#if vm.isEmpty}
		<!-- Honest empty: the styled honest-absence chip (says WHY), never a wall of
		     empties / fabricated zero. -->
		<div class="snapshot-strip__empty" data-slot="empty-note">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<!-- Top metric cards (S6): wide two-column cards, grouped into two rows.
		     col1 = (i) + label + value; col2 = the always-visible explanation. -->
		<div class="snapshot-cards">
			<!-- Row 1 — the headline rates. -->
			<div class="snapshot-cards__row" data-slot="snapshot-row-1">
				<ExplainedMetricCard
					label={t.otpPct}
					value={fmtPct(vm.otpPct)}
					explanation={info('otp', t.otpPct).tip}
					info={otpInfo}
					emptyLabel={t.noData}
					absentReason="no-observations"
					{locale}
				/>
				<ExplainedMetricCard
					label={t.avgDelayMin}
					value={fmtMin(vm.avgDelayMin)}
					explanation={info('avgDelay', t.avgDelayMin).tip}
					info={avgInfo}
					emptyLabel={t.noData}
					absentReason="no-observations"
					{locale}
				/>
				<ExplainedMetricCard
					label={t.cancellationRatePct}
					value={fmtPct(vm.cancellationRatePct)}
					explanation={info('cancellation', t.cancellationRatePct).tip}
					info={cancellationInfo}
					note={vm.perMetric.cancellationRatePct ? t.rampInNote : undefined}
					emptyLabel={t.noData}
					absentReason="no-observations"
					{locale}
				/>
				<ExplainedMetricCard
					label={t.skippedStopRatePct}
					value={fmtPct(vm.skippedStopRatePct)}
					explanation={info('skippedStop', t.skippedStopRatePct).tip}
					info={skippedInfo}
					sublabel={t.skippedStopCaption}
					note={vm.perMetric.skippedStopRatePct ? t.rampInNote : undefined}
					emptyLabel={t.noData}
					absentReason="no-observations"
					{locale}
				/>
			</div>

			<!-- Row 2 — the delay-distribution reads. -->
			<div class="snapshot-cards__row" data-slot="snapshot-row-2">
				<ExplainedMetricCard
					label={t.headwayRegularityCov}
					value={fmtCov(vm.headwayRegularityCov)}
					explanation={info('regularityCov', t.headwayRegularityCov).tip}
					info={regularityInfo}
					sublabel={regularityCaption ?? undefined}
					emptyLabel={t.noData}
					absentReason="no-observations"
					{locale}
				/>
				<ExplainedMetricCard
					label={t.p90Min}
					value={fmtMin(vm.p90Min)}
					explanation={info('p50p90', t.p90Min).tip}
					info={p90Info}
					sublabel={t.p90Caption}
					emptyLabel={t.noData}
					absentReason="no-observations"
					{locale}
				/>
				<ExplainedMetricCard
					label={t.p50Min}
					value={fmtMin(vm.p50Min)}
					explanation={info('p50p90', t.p50Min).tip}
					info={p50Info}
					sublabel={t.p50Caption}
					emptyLabel={t.noData}
					absentReason="no-observations"
					{locale}
				/>
			</div>
		</div>
	{/if}
</section>

<style>
	/* Full-bleed band: edge-to-edge surface that breathes against the surface's
	   bleed gutter (the parent band wrapper owns the page padding). */
	.snapshot-strip {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
	}
	/* The two metric rows, stacked. */
	.snapshot-cards {
		display: flex;
		flex-direction: column;
		gap: 1rem 1.25rem;
		width: 100%;
	}
	/* Each row is an auto-fit grid of WIDE cards: cards stay wide enough for their
	   internal col1 | col2 layout and wrap as space runs out (4-up / 3-up on a wide
	   desktop, fewer on a laptop, 1-up on a phone). Each card flips its OWN internal
	   layout off its container width (see ExplainedMetricCard). */
	.snapshot-cards__row {
		display: grid;
		gap: 1rem 1.25rem;
		grid-template-columns: repeat(auto-fit, minmax(min(27rem, 100%), 1fr));
		align-items: stretch;
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
