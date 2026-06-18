<!--
  RouteDetail — the per-line detail screen (slice-9.3).

  Composes the surface spine: an EntityDetail tabbed scaffold (Détail / Horaire /
  Fiabilité) headed by a SectionHeading. Each pane owns its own data load wrapped
  in a ResourceBoundary, so skeleton / error / empty render per-pane without
  bespoke plumbing:

    - detail + schedule  → static getRoute(id)            (RouteFile | null)
    - reliability        → historic getRouteReliability(id) (RouteReliability | null)

  A null load (HTTP 404) is the empty signal, not an error — ResourceBoundary
  routes it to the empty edge state. Raw reliability periods are mapped to the
  spine's normalized ReliabilityPeriodVM; domain vocabulary (OTP / delay / p90 /
  severe) is intrinsic to ReliabilityPane. Locale via getLocale(); non-intrinsic
  copy is co-located. Tokens, no hex; --primary stays interactive-only.
-->
<script lang="ts">
	import { getLocale } from '$lib/i18n';
	import { mapHrefFor } from '$lib/nav';
	import { getRoute, getRouteReliability } from '$lib/v1';
	import type { RouteFile, RouteReliability, ReliabilityPeriod } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		EntityDetail,
		ResourceBoundary,
		ReliabilityPane,
		MapDrilldownLink,
		type ReliabilityPeriodVM,
	} from '$lib/components/surface';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { detailCopy } from './lines.copy';

	interface RouteDetailProps {
		/** The route id this surface details. */
		id: string;
	}

	let { id }: RouteDetailProps = $props();

	const locale = getLocale();
	const t = $derived(detailCopy[locale]);

	type TabKey = 'detail' | 'schedule' | 'reliability';
	const tabs = $derived<{ key: TabKey; label: string }[]>([
		{ key: 'detail', label: t.tabs.detail },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'reliability', label: t.tabs.reliability },
	]);
	let active = $state<TabKey>('detail');

	// detail + schedule share the static route file (reactive to `id`).
	const route = createResource<RouteFile | null>(() => getRoute(id));
	// reliability is the historic per-route archive (reactive to `id`).
	const reliability = createResource<RouteReliability | null>(() => getRouteReliability(id));

	// Raw reliability periods → the spine's normalized VM (delayLabelKind="avg").
	const toVM = (p: ReliabilityPeriod): ReliabilityPeriodVM => ({
		grain: p.grain,
		otpPct: p.otp_pct ?? null,
		delayMin: p.avg_delay_min ?? null,
		p90Min: p.p90_min ?? null,
		severePct: p.severe_pct ?? null,
	});
	// The live reliability strip renders only the primary period grains and the
	// busiest-direction headway. The granularity grains (shift / weekday-weekend
	// day-type) and per-direction headway ('*_dir*') ride in the /v1 data for the
	// dedicated grouped sections in the 9.6 reliability surface, not this flat strip.
	const PRIMARY_GRAINS = new Set(['day', 'week', 'month']);
	const periodVMs = $derived<ReliabilityPeriodVM[]>(
		(reliability.data?.periods ?? []).filter((p) => PRIMARY_GRAINS.has(p.grain)).map(toVM),
	);
	const displayHeadway = $derived(
		(reliability.data?.headway ?? []).filter((h) => !h.shift.includes('_dir')),
	);

	const fmtMin = (v: number | null | undefined): string =>
		v == null ? '—' : `${v.toFixed(1)} min`;
</script>

<EntityDetail kicker={t.kicker} {tabs} bind:active>
	{#snippet header()}
		<div class="route-detail-head">
			<SectionHeading heading={id} level={1} dot />
			<MapDrilldownLink
				href={mapHrefFor({ route: id }, locale)}
				label={t.viewOnMap}
				ariaLabel={t.viewRouteOnMap(id)}
			/>
		</div>
	{/snippet}

	{#snippet pane(key)}
		{#if key === 'detail'}
			<ResourceBoundary resource={route} lang={locale}>
				{#snippet children(file)}
					<div class="route-section">
						<SectionLabel text={t.directions} variant="metric" />
						{#if (file.directions ?? []).length > 0}
							<ul class="route-directions">
								{#each file.directions ?? [] as dir (dir.dir)}
									<li class="route-direction">
										<span class="route-direction-head">
											<span class="route-direction-name">
												{dir.headsign ?? t.direction(dir.dir)}
											</span>
											<span class="route-direction-meta">
												{t.stopsCount((dir.stops ?? []).length)}
											</span>
										</span>
										{#if (dir.stops ?? []).length > 0}
											<ol class="route-stops">
												{#each dir.stops ?? [] as stop (stop.id)}
													<li class="route-stop">
														<span class="route-stop-seq">{stop.seq}</span>
														<span class="route-stop-name">{stop.name ?? stop.id}</span>
													</li>
												{/each}
											</ol>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'schedule'}
			<ResourceBoundary resource={route} lang={locale}>
				{#snippet children(file)}
					<div class="route-section">
						<div class="route-departures">
							<MetricDisplay
								value={file.first_departure ?? '—'}
								label={t.firstDeparture}
								size="sm"
							/>
							<MetricDisplay value={file.last_departure ?? '—'} label={t.lastDeparture} size="sm" />
						</div>
						<SectionLabel text={t.servicePeriods} variant="metric" />
						{#if (file.service_periods ?? []).length > 0}
							<ul class="route-periods">
								{#each file.service_periods ?? [] as sp (sp.shift)}
									<li class="route-period">
										<SectionLabel text={sp.shift} variant="metric" />
										<div class="route-period-metrics">
											{#if sp.window}
												<MetricDisplay value={sp.window} label={t.window} size="sm" />
											{/if}
											{#if sp.headway_min != null}
												<MetricDisplay value={fmtMin(sp.headway_min)} label={t.headway} size="sm" />
											{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/snippet}
			</ResourceBoundary>
		{:else}
			<ResourceBoundary resource={reliability} lang={locale}>
				{#snippet children(rel)}
					<div class="route-section">
						<ReliabilityPane periods={periodVMs} {locale} delayLabelKind="avg" />

						{#if displayHeadway.length > 0}
							<div class="route-subsection">
								<SectionLabel text={t.headways} variant="metric" />
								<ul class="route-periods">
									{#each displayHeadway as hw (hw.shift)}
										<li class="route-period">
											<SectionLabel text={hw.shift} variant="metric" />
											<div class="route-period-metrics">
												<MetricDisplay
													value={fmtMin(hw.scheduled_min)}
													label={t.scheduled}
													size="sm"
												/>
												<MetricDisplay
													value={fmtMin(hw.observed_min)}
													label={t.observed}
													size="sm"
												/>
												{#if hw.excess_wait_min != null}
													<MetricDisplay
														value={fmtMin(hw.excess_wait_min)}
														label={t.excessWait}
														size="sm"
													/>
												{/if}
											</div>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if (rel.weak_stops ?? []).length > 0}
							<div class="route-subsection">
								<SectionLabel text={t.weakStops} variant="metric" />
								<ul class="route-weak-stops">
									{#each rel.weak_stops ?? [] as ws (ws.id)}
										<li class="route-weak-stop">
											<span class="route-weak-stop-name">{ws.name ?? ws.id}</span>
											<span class="route-weak-stop-meta">
												{t.medianDelay}: {fmtMin(ws.median_delay_min)}
											</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/snippet}
			</ResourceBoundary>
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.route-detail-head {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}
	.route-section {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.route-subsection {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.route-directions {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.route-direction {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.route-direction-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.route-direction-name {
		font-family: var(--font-heading);
		font-weight: 600;
		font-size: var(--text-subheading);
		color: var(--foreground);
	}
	.route-direction-meta {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.route-stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.route-stop {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.route-stop:last-child {
		border-bottom: none;
	}
	.route-stop-seq {
		flex-shrink: 0;
		min-width: 2ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		text-align: right;
	}
	.route-stop-name {
		font-size: var(--text-body);
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.route-departures {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.route-periods {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@media (min-width: 640px) {
		.route-periods {
			grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		}
	}
	@media (max-width: 520px) {
		.route-detail-head {
			align-items: start;
			flex-direction: column;
		}
	}
	.route-period {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1rem 1.25rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
	}
	.route-period-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	.route-weak-stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.route-weak-stop {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.route-weak-stop:last-child {
		border-bottom: none;
	}
	.route-weak-stop-name {
		font-size: var(--text-body);
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.route-weak-stop-meta {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
