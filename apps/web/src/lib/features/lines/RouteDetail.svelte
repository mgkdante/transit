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
	import type { RouteFile, RouteReliability } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { EntityDetail, ResourceBoundary, MapDrilldownLink } from '$lib/components/surface';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import RouteReliabilityClusters from './reliability/RouteReliabilityClusters.svelte';
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

	// schedule pane formats headway minutes; the reliability tab is now the
	// dedicated 9.6 clustered surface (RouteReliabilityClusters) — it owns its own
	// formatting + the snapshot strip + 5 cluster bands off the same archive.
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
					<RouteReliabilityClusters data={rel} {locale} />
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
</style>
