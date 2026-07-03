<!--
  NetworkSurface — the /network surface ORCHESTRATOR (S9A re-seat of NetworkHealth.svelte).

  Decomposes the former 1,432-line god-file into a network/reliability tree modelled 1:1 on the
  stops/reliability re-seat (StopReliabilitySurface). This orchestrator owns EVERYTHING the
  sections must not: the live store + the trend/provenance resources, the codec-seeded
  grain/window/retard state + their clamps, the URL mirror, the ONE mapping pass through the
  pure selectors, and the LIVE/HISTORIC region layout with the STICKY SurfaceControls rail.
  Each section is a pure presenter fed one VM slice.

  LIVE tier (S9C · DECISIONS C1–C4): the top board is FOUR glance ExplainedMetricCards
  (on_time_pct · coverage_pct · delay_p50 · delay_p90); vehicles_in_service + non_responding +
  non_responding_by_route move WHOLLY into the dedicated Reporting row (SectionReporting) with
  the global-signal caveat. The delay histogram is RE-SEATED off the hand-rolled /max <ul> onto
  the ChartSpec kernel (SectionDelayHistogram) on an absolute count domain. status/occupancy
  mixes render as stacked-share specs through the ONE <Chart> renderer (P5.2).

  MIRROR-PATH (DECISIONS A1 — recorded, no churn): grain/window mirror to the URL via
  mirrorSearchParams (in-place, MERGES, preserves other params); the status/occupancy map
  cross-filter is a DISTINCT mechanism — it stays map-owned via openSurface→goto (a full
  navigation to /map), never routed through this surface's search mirror. Two URL seams, kept
  separate exactly as before the re-seat.

  DOCTRINE: every data mark rides the dataviz scale; --primary stays interactive-only (the
  grain/window/series pickers are interactive affordances). Honesty — a null headline shows the
  styled AbsentValue chip, never a fabricated 0; null trend points are gaps; a day with no
  occupancy telemetry is skipped. Before the first live tick a skeleton EdgeState; a live-store
  error shows error-v1. All prose comes from ../network-reliability.copy.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeNameFallback } from '$lib/site/absence';
	import { layout, routeFor } from '$lib/nav';
	import { mapSearchFor, fromSearchParams, toSearchParams, emptyFilterState } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { formatDateKey, formatRelativeSeconds } from '$lib/utils/time';
	import {
		fmtCount as sharedFmtCount,
		fmtDelayMin as sharedFmtDelayMin,
		fmtPct as sharedFmtPct,
	} from '$lib/utils';
	import {
		createLiveStore,
		getNetworkTrend,
		getProvenance,
		getV1Context,
		type OccupancyCode,
		type StatusCode,
		type TrendPoint,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { shiftLabel, dayTypeLabel } from '$lib/features/reliability/shiftGrains';
	import {
		SurfaceHeader,
		FreshnessStamp,
		ConformanceBadge,
		ResourceBoundary,
		SurfaceControls,
		GrainPicker,
		type GrainSegment,
	} from '$lib/components/surface';
	import { Surface, ControlsRail, DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { EdgeState } from '$lib/components/edge';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { STATUS_LABELS, OCCUPANCY_LABELS } from '$lib/v1/enumLabels';

	import {
		presentGrains,
		defaultNetworkGrain,
		NETWORK_GRAINS,
		type NetworkGrain,
	} from '../data/presentGrains';
	import { WINDOWS, bestFitWindow, windowedSeries, type WindowDays } from '../data/trendWindow';
	import { selectHeadlineKpis } from '../selectors/headlineKpis';
	import { selectStatusMix } from '../selectors/statusMix';
	import { selectOccupancyMix } from '../selectors/occupancyMix';
	import { selectDelayHistogram } from '../selectors/delayHistogram';
	import { selectSilentByRoute } from '../selectors/silentByRoute';
	import { selectTrendChart, selectVehiclesSpark } from '../selectors/trendChart';
	import { selectCancelTrend } from '../selectors/cancelTrend';
	import { selectCompleteness } from '../selectors/completeness';
	import { selectOccupancyTrend } from '../selectors/occupancyTrend';
	import { selectShiftRank } from '../selectors/shiftRank';
	import { networkReliabilityCopy } from '../network-reliability.copy';

	import SectionLiveHeadline from './SectionLiveHeadline.svelte';
	import SectionReporting from './SectionReporting.svelte';
	import SectionStatusMix from './SectionStatusMix.svelte';
	import SectionDelayHistogram from './SectionDelayHistogram.svelte';
	import SectionTrend from './SectionTrend.svelte';
	import SectionCancellations from './SectionCancellations.svelte';
	import SectionCompleteness from './SectionCompleteness.svelte';
	import SectionCrowdingByDay from './SectionCrowdingByDay.svelte';
	import SectionByTimeOfDay from './SectionByTimeOfDay.svelte';
	import SectionWeekday from './SectionWeekday.svelte';

	const locale: Locale = getLocale();
	const t = $derived(networkReliabilityCopy[locale]);

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>, wired onto every KPI + section heading so each number carries its
	// honest definition (same wiring as RouteDetail / StopReliabilitySurface).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// Live tier — one store instance; the v1 context is booted by the time the tree renders.
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// Historic tier — the daily network trend (createResource, browser-only).
	const trend = createResource(() => getNetworkTrend());
	// Honesty layer — the provider's feed-conformance verdict (provenance.json). Supplementary:
	// a null/errored fetch renders nothing, never a blocking boundary.
	const provenance = createResource(() => getProvenance());

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	/* ── formatters (locale-bound; kept out of the selectors) ─────────────────────── */
	const fmtMin = (v: number | null): string =>
		sharedFmtDelayMin(v, { suffix: t.units.min, noData: t.noData });
	const fmtCount = (v: number): string => sharedFmtCount(v, { locale, noData: '' });
	// MetricDisplay-fed variants return NULL (not the noData string) on no-data so the tile
	// renders the STYLED honest-absence chip (AbsentValue) instead of a plain "no data".
	const pctOrNull = (v: number | null): string | null => sharedFmtPct(v, { suffix: t.units.pct });
	const minOrNull = (v: number | null): string | null =>
		sharedFmtDelayMin(v, { suffix: t.units.min });
	const fmtCancel = (v: number | null): string | null =>
		sharedFmtPct(v, { rounding: 'fixed1', suffix: t.units.pct });

	// Worker-cycle feed staleness (distinct from the snapshot-publish age the FreshnessStamp
	// shows). feed_freshness_s is the seconds since the worker last refreshed the feed AS OF the
	// snapshot; we add live.ageSeconds (the ticking shared-clock delta) so the age advances
	// between the 30s polls in lockstep with the FreshnessStamp. null → honest no-data.
	const feedAge = $derived.by<string | null>(() => {
		const s = live.network?.feed_freshness_s ?? null;
		if (s == null) return null;
		return formatRelativeSeconds(s + (live.ageSeconds ?? 0), locale);
	});

	/* ── LIVE mapping pass ────────────────────────────────────────────────────────── */
	const kpis = $derived.by(() =>
		live.network
			? selectHeadlineKpis(live.network, {
					onTime: t.metrics.onTime,
					coverage: t.metrics.coverage,
					delayP50: t.metrics.delayP50,
					delayP90: t.metrics.delayP90,
					vehicles: t.metrics.vehicles,
					notReporting: t.metrics.notReporting,
					pctOrNull,
					minOrNull,
					fmtCount,
				})
			: null,
	);
	const statusSpec = $derived(
		selectStatusMix(
			live.network?.status_dist ?? null,
			(c: StatusCode) => STATUS_LABELS[locale][c],
			{
				title: t.statusBarLabel,
				locale,
				hrefFor: (code: StatusCode) =>
					localizeHref(routeFor({ kind: 'map', search: mapSearchFor({ status: [code] }) }), locale),
			},
		),
	);
	const occupancyMix = $derived(
		selectOccupancyMix(
			live.network?.occupancy_mix ?? null,
			(c: OccupancyCode) => OCCUPANCY_LABELS[locale][c],
			{
				title: t.occupancyBarLabel,
				locale,
				hrefFor: (code: OccupancyCode) =>
					localizeHref(
						routeFor({ kind: 'map', search: mapSearchFor({ occupancy: [code] }) }),
						locale,
					),
			},
		),
	);
	const delayHistogramSpec = $derived(
		selectDelayHistogram(
			live.network?.delay_histogram,
			live.network?.delay_p50_min ?? null,
			live.network?.delay_p90_min ?? null,
			locale,
			{
				title: t.delayHistogram.summary,
				caption: t.delayHistogram.caption,
				unit: t.units.min,
				xLabel: t.delayHistogram.xLabel,
				yLabel: t.delayHistogram.yLabel,
			},
		),
	);
	const silentRows = $derived(
		selectSilentByRoute(live.network?.non_responding_by_route, {
			routeName: (rid) => routeNameFallback(rid, locale),
			rowLabel: t.nonResponding.rowLabel,
			display: (rid, count) => `${fmtCount(count)} ${t.nonResponding.tripsUnit(count)}`,
			href: (rid) => localizeHref(routeFor({ kind: 'line', id: rid }), locale),
			viewDetail: (rid) => t.nonResponding.viewDetail(rid),
		}),
	);

	// Live map cross-filters (DECISIONS A1) ride each band's spec `href` now (P5.2) —
	// the legacy onSelect callbacks were plain navigations, so the URL IS the contract.

	/* ── HISTORIC: grain (day/week/month) ─────────────────────────────────────────── */
	const dailySeries = $derived<TrendPoint[]>(trend.data?.series ?? []);
	const weeklySeries = $derived<TrendPoint[]>(trend.data?.weekly ?? []);
	const monthlySeries = $derived<TrendPoint[]>(trend.data?.monthly ?? []);
	const allSeries = $derived({ daily: dailySeries, weekly: weeklySeries, monthly: monthlySeries });
	const present = $derived(presentGrains(allSeries));

	// CONTRACT: the codec ($lib/filters) owns the URL seams — fromSearchParams enum-parses the
	// ?grain seed (invalid values dropped); toSearchParams serializes it back (day = default →
	// omitted). The SELECTION STATE + the populated-grain clamp stay SURFACE-LOCAL: only this
	// surface knows which grains its series populate.
	let grainKey = $state<NetworkGrain>(
		(() => {
			const seeded = fromSearchParams(page.url.searchParams).grain;
			return seeded === 'week' || seeded === 'month' ? seeded : 'day';
		})(),
	);
	const grain = $derived<NetworkGrain>(grainKey);
	const isDailyGrain = $derived(grain === 'day');

	const grainAvailability = $derived({
		day: { buckets: dailySeries.length },
		week: { buckets: weeklySeries.length },
		month: { buckets: monthlySeries.length },
	});
	const grainLabels: Partial<Record<NetworkGrain, string>> = $derived({
		day: t.grain.day,
		week: t.grain.week,
		month: t.grain.month,
	});
	// The grain picker is a dead control when only one grain carries data, so it renders ONLY
	// when MORE THAN ONE grain is populated.
	const showGrainPicker = $derived(present.size > 1);

	// Keep the selection on a POPULATED grain — the codec-owned clamp: a chosen coarse grain
	// whose series is absent falls back to the richest present grain (day→week→month); an empty
	// daily series falls the day grain FORWARD. Never a dead/empty grain.
	$effect(() => {
		if (present.size > 0 && !present.has(grainKey)) grainKey = defaultNetworkGrain(present);
	});

	// Mirror the resolved grain (day = default → omitted). Uses the shared codec's wire format +
	// the batched mirror (MERGES, preserves other params — the recorded A1 mirror-path).
	const grainWire = $derived.by<{ grain: string | null }>(() => {
		const state = emptyFilterState();
		if (grainKey !== 'day') state.grain = grainKey;
		return { grain: toSearchParams(state).get('grain') };
	});
	$effect(() => mirrorSearchParams(grainWire));

	/* ── HISTORIC: trend window (7/30/90-day, DAY grain only) ─────────────────────── */
	const bestFit = $derived<WindowDays>(bestFitWindow(dailySeries.length));

	let windowKey = $state('7');
	let windowSeeded = $state(false);
	const windowDays = $derived.by<WindowDays>(() => {
		const d = Number(windowKey);
		return (WINDOWS as readonly number[]).includes(d) ? (d as WindowDays) : bestFit;
	});
	const windowSegments = $derived.by<GrainSegment<string>[]>(() => {
		const n = dailySeries.length;
		const labels: Record<WindowDays, string> = {
			7: t.window.d7,
			30: t.window.d30,
			90: t.window.d90,
		};
		// A window is offered when ANY data exists; DISABLED when it would exceed the length —
		// except the smallest window, which is always offered (there is always one enabled segment).
		return WINDOWS.map((d, i) => ({
			key: String(d),
			label: labels[d],
			available: n > 0 && (i === 0 || d <= n),
		}));
	});
	// Default to the richest-fit window once the data settles, then clamp DOWN if a later
	// (smaller) series no longer fits. The 7-day window always fits, so this never loops.
	$effect(() => {
		const n = dailySeries.length;
		if (n === 0) return;
		if (!windowSeeded) {
			windowKey = String(bestFit);
			windowSeeded = true;
		} else if (windowDays > n && windowDays !== 7) {
			windowKey = String(bestFit);
		}
	});

	/* ── HISTORIC: delay-series toggle (p90 vs avg) ───────────────────────────────── */
	let retardKey = $state('p90');
	const retardSegments = $derived.by<GrainSegment<string>[]>(() => [
		// p90 has no week/month data → disabled on a coarse grain (never a flat-null line).
		{ key: 'p90', label: t.trend.retardP90, available: isDailyGrain },
		{ key: 'avg', label: t.trend.retardAvg },
	]);
	// The EFFECTIVE retard series: the rider's pick on the day grain, forced to avg on week/month.
	const effectiveRetard = $derived<'p90' | 'avg'>(
		isDailyGrain && retardKey === 'p90' ? 'p90' : 'avg',
	);
	// Snap the picker SELECTION to 'avg' on a coarse grain (keep the highlighted chip in lockstep
	// with the plotted series — p90 is disabled there).
	$effect(() => {
		if (!isDailyGrain && retardKey === 'p90') retardKey = 'avg';
	});
	const retardLabel = $derived(
		effectiveRetard === 'avg' ? t.metrics.delayP50 : t.trend.retardLabel,
	);

	/* ── HISTORIC mapping pass — ONE window slice shared by every mark ────────────── */
	const windowed = $derived<readonly TrendPoint[]>(windowedSeries(grain, allSeries, windowDays));
	const trendSpec = $derived(
		selectTrendChart(windowed, effectiveRetard, {
			locale,
			title: t.trend.summary,
			onTimeLabel: t.trend.onTimeLabel,
			retardLabel,
			pctUnit: t.units.pct,
			minUnit: t.units.min,
		}),
	);
	const vehiclesSpark = $derived(
		selectVehiclesSpark(windowed, {
			locale,
			title: t.trend.vehiclesSpark,
			label: t.trend.vehiclesSpark,
		}),
	);
	const cancelTrend = $derived(
		selectCancelTrend(windowed, {
			locale,
			title: t.cancel.summary,
			seriesLabel: t.cancel.seriesLabel,
			pctUnit: t.units.pct,
		}),
	);
	// Service completeness (GC2 service_completeness_rate): stands UP only once a windowed point
	// carries a non-null rate (null across the whole retained window on prod today — ramp-in).
	const completeness = $derived(selectCompleteness(windowed));
	const completenessDisplay = $derived(fmtCancel(completeness.latest));
	const occupancyDays = $derived(
		selectOccupancyTrend(
			windowed,
			(d) => formatDateKey(d, locale),
			(c: OccupancyCode) => OCCUPANCY_LABELS[locale][c],
			{ locale, titleFor: (dateLabel) => `${t.occupancySection} · ${dateLabel}` },
		),
	);
	const hasOccupancyTrend = $derived(isDailyGrain && occupancyDays.length > 0);

	const pctOrNullSubtitle = (avg: number | null, severe: number | null): string =>
		`${t.shift.avgLabel} ${fmtMin(avg)} · ${t.shift.severeLabel} ${sharedFmtPct(severe, { rounding: 'fixed1', suffix: t.units.pct, noData: t.noData })}`;
	const shiftRows = $derived(
		selectShiftRank(trend.data?.by_shift ?? [], {
			grainLabel: (g) => shiftLabel(g, locale),
			pctOrNull,
			subtitle: pctOrNullSubtitle,
		}),
	);
	const dayTypeRows = $derived(
		selectShiftRank(trend.data?.by_daytype ?? [], {
			grainLabel: (g) => dayTypeLabel(g, locale),
			pctOrNull,
			subtitle: pctOrNullSubtitle,
		}),
	);
	const hasShift = $derived(shiftRows.length > 0);
	const hasDayType = $derived(dayTypeRows.length > 0);
</script>

<Surface class="network">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} lede={t.lede}>
		<div class="network-feed-health">
			<FreshnessStamp
				variant="live"
				generatedUtc={live.generatedUtc}
				ageSeconds={live.ageSeconds}
				isStale={live.isStale}
				{locale}
			/>
			<!-- Worker-cycle feed age — a SECOND freshness signal. Null → honest no-data. -->
			{#if feedAge != null}
				<span
					class="network-feed-age"
					data-slot="feed-age"
					aria-label={`${t.feedAge.a11yPrefix} ${feedAge}`}
				>
					<span class="network-feed-age-label">{t.feedAge.label}</span>
					<span class="network-feed-age-value">{feedAge}</span>
				</span>
			{/if}
			<ConformanceBadge conformance={provenance.data?.conformance} {locale} />
		</div>
	</SurfaceHeader>

	<Separator variant="hazard" />

	<!-- ── LIVE region ──────────────────────────────────────────────────────────────
	     Four glance cards (C1) · the Reporting row (vehicles + non_responding + silent
	     lines + the global-signal caveat) · the two distribution bars · the re-seated
	     delay histogram. -->
	<!-- TODO(beauty2-honest-absence · DECISIONS C3): when net.vehicles_in_service === 0 (live
	     zero / overnight), surface an honest-absence banner above the headline board via
	     $lib/site/serviceWindow.inferAbsenceReason. Like /map this is a NETWORK-WIDE view with
	     no single first/last window, so a "service closed / overnight" verdict needs a network
	     service-span signal we do not yet publish. DEFERRED — carried to the S9 Handoff with the
	     pipeline note (needs an unpublished network service-span signal). -->
	{#if kpis}
		<section class="network-region" aria-label={t.liveRegion}>
			<SectionLabel text={t.liveRegion} variant="station" />
			<SectionLiveHeadline cards={kpis.headline} {info} noData={t.noData} {locale} />
			<SectionReporting
				cards={kpis.reporting}
				{silentRows}
				{info}
				copy={t}
				noData={t.noData}
				{locale}
			/>
			<SectionStatusMix
				{statusSpec}
				occupancySpec={occupancyMix.spec}
				hasOccupancy={occupancyMix.hasOccupancy}
				{info}
				copy={t}
			/>
			<SectionDelayHistogram spec={delayHistogramSpec} {info} copy={t} />
		</section>
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

	<Separator variant="hazard" />

	<!-- ── HISTORIC region ──────────────────────────────────────────────────────────
	     The three scattered controls (grain · window · delay series) collected into ONE
	     STICKY rail, then the readout board (the main trend spanning a wide cell). -->
	<section class="network-region" aria-label={t.historicRegion}>
		<SectionLabel text={t.historicRegion} variant="station" />

		{#snippet windowControls()}
			<!-- Trend window (7/30/90-day) — DAY grain only; slices the tail. Week/month render
			     their full short series → no window. -->
			{#if isDailyGrain}
				<GrainPicker
					segments={windowSegments}
					bind:value={windowKey}
					label={t.window.label}
					class="network-window"
				/>
			{/if}
			<!-- Delay-series toggle: p90 vs avg. p90 disables on a coarse grain (no week/month data). -->
			<GrainPicker
				segments={retardSegments}
				bind:value={retardKey}
				label={t.trend.retardToggleLabel}
				class="network-retard-toggle"
			/>
		{/snippet}

		{#if showGrainPicker}
			<!-- STICKY rail (S9A · C). minPoints=1 keeps TODAY's enable-iff-any-data semantics. -->
			<SurfaceControls
				offered={NETWORK_GRAINS}
				availability={grainAvailability}
				bind:value={grainKey}
				minPoints={1}
				labels={grainLabels}
				grainLabel={t.grain.label}
				railLabel={t.viewControlsLabel}
				sticky
				{locale}
				window={windowControls}
			/>
		{:else}
			<ControlsRail label={t.viewControlsLabel} sticky>
				{@render windowControls()}
			</ControlsRail>
		{/if}

		<Separator variant="hazard" hazardSize="sm" />

		<ResourceBoundary
			resource={trend}
			lang={locale}
			isEmpty={(d) =>
				(d.series?.length ?? 0) === 0 &&
				(d.weekly?.length ?? 0) === 0 &&
				(d.monthly?.length ?? 0) === 0}
		>
			<!-- The readouts read the module-level windowed VMs (not the boundary payload). -->
			<DashboardGrid minTile="360px" align="start" gutter={false}>
				<SectionTrend {trendSpec} {vehiclesSpark} {isDailyGrain} {info} copy={t} />

				{#if cancelTrend.hasCancel}
					<SectionCancellations
						vm={cancelTrend}
						latestDisplay={fmtCancel(cancelTrend.latest)}
						{info}
						copy={t}
						noData={t.noData}
						{locale}
					/>
				{/if}

				<!-- SERVICE COMPLETENESS (S9B · GC2): ALWAYS rendered — while the rate is null
				     (ramp-in on prod today) the tile carries its honest-absence note; a citizen
				     sees "no data + why", never a silently missing section. -->
				<SectionCompleteness
					latestDisplay={completenessDisplay}
					{info}
					copy={t}
					noData={t.noData}
					{locale}
				/>

				{#if hasOccupancyTrend}
					<SectionCrowdingByDay days={occupancyDays} {info} copy={t} />
				{/if}

				<!-- The `network-shift` data-slot + the trailing-window caveat are COORDINATED here:
				     the shift tile hosts the anchor when present, else the day-type tile; the caveat
				     renders on the day-type tile when present, else the shift tile (never duplicated). -->
				{#if hasShift}
					<SectionByTimeOfDay
						rows={shiftRows}
						dataSlot="network-shift"
						showCaveat={!hasDayType}
						{info}
						copy={t}
						{locale}
					/>
				{/if}
				{#if hasDayType}
					<SectionWeekday
						rows={dayTypeRows}
						dataSlot={hasShift ? undefined : 'network-shift'}
						showCaveat={true}
						{info}
						copy={t}
						{locale}
					/>
				{/if}
			</DashboardGrid>
		</ResourceBoundary>
	</section>
</Surface>

<style>
	.network-feed-health {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1.25rem;
	}
	/* A surface region (LIVE / HISTORIC) — its station label, control panel and readout board
	   stacked. The hazard Separator between regions lives outside. */
	.network-region {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* Worker-feed-age chip — a quiet mono badge beside the LIVE freshness chip. */
	.network-feed-age {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.network-feed-age-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.network-feed-age-value {
		color: var(--foreground);
	}
</style>
