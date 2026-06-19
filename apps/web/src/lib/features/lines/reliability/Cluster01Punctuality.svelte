<!--
  Cluster01Punctuality — the "01 Punctuality" band of the slice-9.6 historic
  Reliability surface (approach B, one band per cluster).

  Reads a `PunctualityVM` (the pure mapper's per-band view-model) + locale +
  the co-located reliability copy. It answers, for the route's punctuality:

    - the SELECTED-grain headline — OTP %, avg delay, p90 delay (MetricDisplay);
    - the OTP trend SHAPE across the available periods (TrendLine: OTP green vs
      the avg-delay/retard amber series, dual y-domains since the units differ);
    - the severe-share magnitude of the selected period (SeverityBar — a [0,1]
      data mark on the dataviz severity scale, NEVER --primary);
    - the accountability element: the weakest stops ranked worst-delay first
      (RankedRow, normalized against the worst stop on the route).

  HONESTY DOCTRINE upheld here:
    - vm.isEmpty → an explicit no-data note; never a fake 0 or a dropped band.
    - every headline is `number | null`; null renders an em-dash, not 0.
    - each data mark rides the dataviz scale; --primary is interaction-only.

  Self-contained: takes its data + locale + copy as props (no resource load, no
  i18n context) so it compiles + renders in isolation before it is wired up.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { ReliabilityPeriod } from '$lib/v1';
	import type { SeverityCode } from '$lib/v1/schemas';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { TrendLine, SeverityBar, RankedRow } from '$lib/components/dataviz';
	import type { PunctualityVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';

	export interface Cluster01PunctualityProps {
		/** The punctuality view-model from `toReliabilityClusters`. */
		vm: PunctualityVM;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The co-located reliability copy bundle for this locale. */
		copy: ReliabilityCopy;
		/**
		 * Which grain the headline answers for. Defaults to 'day'; falls back to
		 * the first available period when that grain is absent — mirrors the
		 * mapper's strip-selection rule.
		 */
		grain?: string;
	}

	let { vm, locale, copy, grain = 'day' }: Cluster01PunctualityProps = $props();

	const EM_DASH = '—';

	// The headline period: the selected grain, else the first period available.
	const headline = $derived<ReliabilityPeriod | null>(
		vm.periods.find((p) => p.grain === grain) ?? vm.periods[0] ?? null,
	);

	const fmtPct = (v: number | null | undefined): string => (v == null ? EM_DASH : `${v}%`);
	const fmtMin = (v: number | null | undefined): string =>
		v == null ? EM_DASH : `${v.toFixed(1)} min`;

	// OTP trend SHAPE across periods: green OTP %, amber avg-delay retard.
	// Each series scales to its OWN y-domain (% vs minutes) — dual domains.
	const otpSeries = $derived(vm.periods.map((p) => p.otp_pct ?? null));
	const retardSeries = $derived(vm.periods.map((p) => p.avg_delay_min ?? null));
	const xLabels = $derived(vm.periods.map((p) => p.grain));
	const hasTrend = $derived(vm.periods.length > 1);
	// Retard y-domain padded to the observed max so the line is never clamped flat.
	const retardMax = $derived.by(() => {
		const reals = retardSeries.filter((v): v is number => v != null && !Number.isNaN(v));
		return reals.length ? Math.max(...reals) : 0;
	});
	const retardDomain = $derived<[number, number]>([0, Math.max(1, Math.ceil(retardMax))]);

	// Severe-share magnitude of the headline period, as a [0,1] data mark. The
	// contract carries severe_pct as a percentage (0..100); null = no data.
	const severePct = $derived(headline?.severe_pct ?? null);
	const severeValue = $derived<number | null>(
		severePct == null ? null : Math.min(1, Math.max(0, severePct / 100)),
	);
	// Severe share is itself a severity reading: band it so the bar colour is honest.
	const severeSeverity = $derived<SeverityCode>(
		severePct == null ? 'watch' : severePct >= 10 ? 'critical' : severePct >= 5 ? 'high' : 'watch',
	);

	// Weakest stops, worst mean-delay first — the accountability list. Normalize
	// each bar against the worst stop so the ranking reads as relative magnitude.
	const rankedStops = $derived.by(() => {
		const rows = vm.weakStops
			.filter((w) => w.avg_delay_min != null)
			.slice()
			.sort((a, b) => (b.avg_delay_min ?? 0) - (a.avg_delay_min ?? 0));
		const worst = rows.length ? (rows[0].avg_delay_min ?? 0) : 0;
		return rows.map((w, i) => {
			const delay = w.avg_delay_min ?? 0;
			const sev: SeverityCode = delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
			return {
				key: w.id,
				rank: i + 1,
				title: w.name ?? w.id,
				severity: sev,
				value: worst > 0 ? Math.min(1, Math.max(0, delay / worst)) : null,
				display: fmtMin(w.avg_delay_min),
			};
		});
	});
</script>

<section class="cluster" aria-label={copy.clusters.punctuality}>
	<SectionLabel text={copy.clusters.punctuality} variant="station" />

	{#if vm.isEmpty}
		<!-- Honest empty: explicit no-data note, never a fake 0 / dropped band. -->
		<p class="cluster-empty" data-testid="punctuality-empty">{copy.strip.noDataNote}</p>
	{:else}
		<!-- Selected-grain headline: OTP %, avg delay, p90 delay. -->
		<div class="cluster-headline">
			<MetricDisplay value={fmtPct(headline?.otp_pct)} label={copy.strip.otpPct} size="lg" />
			<MetricDisplay
				value={fmtMin(headline?.avg_delay_min)}
				label={copy.strip.avgDelayMin}
				size="md"
			/>
			<MetricDisplay value={fmtMin(headline?.p90_min)} label={copy.strip.p90Min} size="md" />
		</div>

		<!-- OTP trend across periods (green) vs avg-delay retard (amber). -->
		{#if hasTrend}
			<div class="cluster-block">
				<SectionLabel text={copy.strip.otpPct} variant="metric" />
				<TrendLine
					onTime={otpSeries}
					retard={retardSeries}
					domain={[0, 100]}
					{retardDomain}
					{xLabels}
					onTimeLabel={copy.strip.otpPct}
					retardLabel={copy.strip.avgDelayMin}
					yAxis={{ label: copy.strip.otpPct, unit: copy.units.pct, domain: [0, 100] }}
					retardAxis={{ label: copy.strip.avgDelayMin, unit: copy.units.min, domain: retardDomain }}
					showYTicks
					interactive
				/>
			</div>
		{/if}

		<!-- Severe-share magnitude of the headline period. -->
		<div class="cluster-block">
			<div class="cluster-block-head">
				<SectionLabel text={copy.strip.p90Min} variant="metric" />
				<span class="cluster-block-value">{fmtPct(severePct)}</span>
			</div>
			<SeverityBar
				severity={severeSeverity}
				value={severeValue}
				label={copy.strip.p90Min}
				interactive
			/>
		</div>

		<!-- Weakest stops — the accountability list, worst delay first. -->
		{#if rankedStops.length > 0}
			<div class="cluster-block">
				<SectionLabel text={copy.strip.avgDelayMin} variant="metric" />
				<div class="cluster-ranked" role="list">
					{#each rankedStops as row (row.key)}
						<RankedRow
							rank={row.rank}
							title={row.title}
							severity={row.severity}
							value={row.value}
							display={row.display}
						/>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</section>

<style>
	.cluster {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.cluster-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.cluster-headline {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
	}
	.cluster-block {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.cluster-block-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.cluster-block-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	.cluster-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
