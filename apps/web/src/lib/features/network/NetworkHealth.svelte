<!--
  NetworkHealth — the /network surface screen (slice-9.3).

  Composes the surface spine + dataviz kit into the network-wide health readout:
    · live tier  — createLiveStore polls network.json; we render the headline
      MetricDisplay grid (on-time %, vehicles in service, coverage %, p50/p90
      delay), a status-mix StackedBar (5 StatusCodes by count) and an
      occupancy-mix StackedBar (5 OccupancyCodes by fraction, null-guarded).
    · historic   — createResource(getNetworkTrend) feeds a TrendLine (on-time %
      vs p90 delay) wrapped in <ResourceBoundary>.

  DOCTRINE: every data mark rides the dataviz scale (StackedBar/TrendLine own
  that); --primary stays interactive-only. Honesty rule — a null headline shows
  the localized "no data" string, never a fabricated 0. Before the first live
  tick we show a skeleton EdgeState; a live-store error shows error-v1. All
  user-facing prose comes from ./network.copy; band labels are localized there.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, type Locale } from '$lib/i18n';
	import { layout, openSurface } from '$lib/nav';
	import { mapSearchFor } from '$lib/filters';
	import {
		createLiveStore,
		getNetworkTrend,
		getV1Context,
		STATUS_CODES,
		OCCUPANCY_CODES,
		type NetworkFile,
		type OccupancyCode,
		type StatusCode,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { SurfaceHeader, LiveFreshness, ResourceBoundary } from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { StackedBar, TrendLine, type StackedSegment } from '$lib/components/dataviz';
	import { EdgeState } from '$lib/components/edge';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { copy as COPY, OCCUPANCY_LABELS, STATUS_LABELS } from './network.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// Live tier — one store instance for this surface; the v1 context is booted
	// by the time the page tree renders, so getV1Context() is safe here.
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// Historic tier — the daily network trend (createResource, browser-only).
	const trend = createResource(() => getNetworkTrend());

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	/** Format a nullable integer percent as "82%" or the honest "no data". */
	function fmtPct(v: number | null): string {
		return v == null ? t.noData : `${v}${t.units.pct}`;
	}
	/** Format a nullable integer-minute delay as "3 min" or "no data". */
	function fmtMin(v: number | null): string {
		return v == null ? t.noData : `${v}${t.units.min}`;
	}
	/** Vehicles in service is a required count — render as a plain integer. */
	function fmtCount(v: number): string {
		return v.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA');
	}

	// Status-mix segments: the 5 StatusCodes by count (StackedBar drops zeros).
	const statusSegments = $derived.by<StackedSegment[]>(() => {
		const net: NetworkFile | null = live.network;
		const dist = net?.status_dist ?? null;
		return STATUS_CODES.map((code: StatusCode) => ({
			code,
			value: dist ? dist[code] : null,
			label: STATUS_LABELS[locale][code],
		}));
	});

	// Occupancy-mix segments: the 5 OccupancyCodes by fraction (0..1). Null-guard:
	// occupancy_mix may be null/absent when no telemetry was received this cycle —
	// skip the whole bar rather than fabricate an even split.
	const hasOccupancy = $derived(live.network?.occupancy_mix != null);
	const occupancySegments = $derived.by<StackedSegment[]>(() => {
		const mix = live.network?.occupancy_mix ?? null;
		return OCCUPANCY_CODES.map((code: OccupancyCode) => ({
			code,
			value: mix ? mix[code] : null,
			label: OCCUPANCY_LABELS[locale][code],
		}));
	});

	// Trend series: on-time % (green, 0–100 axis) vs p90 delay (amber, MINUTES).
	// The two carry different units, so the delay series gets its own y-domain
	// [0, niceCeil(maxP90)] — plotting minutes on the percentage axis would squash
	// the delay line flat against the floor. null points are gaps (never zero).
	function trendSeries(points: { otp_pct?: number | null; p90_min?: number | null }[]) {
		const retard = points.map((p) => p.p90_min ?? null);
		const maxP90 = retard.reduce<number>((m, v) => (v != null && v > m ? v : m), 0);
		// Round the ceiling up to the nearest 5 min (floor of 10) so the delay
		// trend uses the plot height without hugging the very top edge.
		const retardCeil = Math.max(10, Math.ceil(maxP90 / 5) * 5);
		return {
			onTime: points.map((p) => p.otp_pct ?? null),
			retard,
			retardDomain: [0, retardCeil] as [number, number],
		};
	}

	function openStatusOnMap(code: StatusCode | OccupancyCode): void {
		if (!STATUS_CODES.includes(code as StatusCode)) return;
		openSurface({ kind: 'map', search: mapSearchFor({ status: [code as StatusCode] }) });
	}
</script>

<Surface width="bleed" class="network">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} lede={t.lede}>
		<LiveFreshness
			generatedUtc={live.generatedUtc}
			ageSeconds={live.ageSeconds}
			isStale={live.isStale}
			{locale}
		/>
	</SurfaceHeader>

	<Separator variant="hazard" />

	{#if live.network}
		{@const net = live.network}
		<!-- Live headline grid -->
		<div class="network-block">
			<SectionLabel text={t.liveSection} variant="station" />
			<div class="network-metrics">
				<MetricDisplay value={fmtPct(net.on_time_pct)} label={t.metrics.onTime} size="lg" />
				<MetricDisplay
					value={fmtCount(net.vehicles_in_service)}
					label={t.metrics.vehicles}
					size="lg"
				/>
				<MetricDisplay value={fmtPct(net.coverage_pct)} label={t.metrics.coverage} size="lg" />
				<MetricDisplay value={fmtMin(net.delay_p50_min)} label={t.metrics.delayP50} size="md" />
				<MetricDisplay value={fmtMin(net.delay_p90_min)} label={t.metrics.delayP90} size="md" />
			</div>
		</div>

		<Separator variant="hazard" />

		<!-- Status mix -->
		<div class="network-block">
			<SectionLabel text={t.statusSection} variant="station" />
			<StackedBar
				scale="status"
				segments={statusSegments}
				label={t.statusBarLabel}
				interactive
				legend
				onSelect={openStatusOnMap}
			/>
		</div>

		<!-- Crowding (occupancy) — only when telemetry was received this cycle -->
		{#if hasOccupancy}
			<div class="network-block">
				<SectionLabel text={t.occupancySection} variant="station" />
				<StackedBar
					scale="occupancy"
					segments={occupancySegments}
					label={t.occupancyBarLabel}
					interactive
					legend
				/>
			</div>
		{/if}
	{:else if live.error}
		<EdgeState
			variant="error-v1"
			lang={locale}
			layout={edgeLayout}
			onRetry={() => live.refresh()}
		/>
	{:else}
		<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
	{/if}

	<!-- Historic daily trend -->
	<div class="network-block">
		<SectionLabel text={t.trendSection} variant="station" />
		<ResourceBoundary resource={trend} lang={locale} isEmpty={(d) => (d.series?.length ?? 0) === 0}>
			{#snippet children(data)}
				{@const series = trendSeries(data.series ?? [])}
				<div class="network-trend">
					<TrendLine
						onTime={series.onTime}
						retard={series.retard}
						retardDomain={series.retardDomain}
						onTimeLabel={t.trend.onTimeLabel}
						retardLabel={t.trend.retardLabel}
						label={t.trend.summary}
						interactive
					/>
				</div>
			{/snippet}
		</ResourceBoundary>
	</div>
</Surface>

<style>
	.network-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.network-metrics {
		margin: 0;
		display: grid;
		gap: 1.25rem 2rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@media (min-width: 640px) {
		.network-metrics {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.network-trend {
		max-width: 40rem;
	}
</style>
