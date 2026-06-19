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
	import { onMount } from 'svelte';
	import { getLocale, localizeHref } from '$lib/i18n';
	import { mapHrefFor, routeFor } from '$lib/nav';
	import {
		createLiveStore,
		deriveRouteStopPredictions,
		getRoute,
		getRouteReliability,
		getV1Context,
	} from '$lib/v1';
	import type { RouteFile, RouteReliability, StopPrediction } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { formatUtc } from '$lib/utils/time';
	import {
		EntityDetail,
		ResourceBoundary,
		MapDrilldownLink,
		LiveFreshness,
	} from '$lib/components/surface';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RouteReliabilityClusters from './reliability/RouteReliabilityClusters.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { detailCopy } from './lines.copy';

	interface RouteDetailProps {
		/** The route id this surface details. */
		id: string;
	}

	let { id }: RouteDetailProps = $props();

	const locale = getLocale();
	const t = $derived(detailCopy[locale]);

	// The in-app metric-explainer (i) affordance, same wiring as the reliability
	// clusters: a one-line tip + a localized deep link to /metrics#<anchor>.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

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

	// Live tier: one store for this surface (the v1 context is booted before
	// mount in the root layout). It polls vehicles/trips on the live ttl; the
	// Detail tab reads its index to derive per-stop predictions (client-side,
	// fail-soft: the static directions/stops render regardless). start()/stop()
	// are browser-only and idempotent.
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// Per-stop SOONEST predicted arrival on this route, derived from the live
	// trips of every bus currently on the route (NO per-stop fetch, a route has
	// 30+ stops). A stop with no live bus predicting it has NO entry → the row
	// shows an honest "no live bus", never a fabricated time.
	const predictions = $derived<ReadonlyMap<string, StopPrediction>>(
		deriveRouteStopPredictions(id, live.index),
	);

	// schedule pane formats headway minutes; the reliability tab is now the
	// dedicated 9.6 clustered surface (RouteReliabilityClusters) — it owns its own
	// formatting + the snapshot strip + 5 cluster bands off the same archive.
	const fmtMin = (v: number | null | undefined): string =>
		v == null ? '·' : `${v.toFixed(1)} min`;

	const stopHref = (stopId: string): string =>
		localizeHref(routeFor({ kind: 'stop', id: stopId }), locale);

	const timeLabel = (iso: string): string =>
		formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false });

	// Plain-language delay reading for the approaching bus, reused from the live
	// vocabulary: early / on time / N min late, or "no delay" when the feed omits it.
	function delayLabel(delay: number | null): string {
		if (delay == null) return t.noDelay;
		if (delay < 0) return t.early(delay);
		if (delay > 0) return t.late(delay);
		return t.onTime;
	}

	// Presentation-only tone mapping a delay to a dataviz status band, matching the
	// map's selection detail so on-time / early / late punch in colour consistently.
	function delayTone(delay: number | null): string {
		if (delay == null) return 'none';
		if (delay < 0) return 'early';
		if (delay >= 5) return 'severe';
		if (delay > 0) return 'late';
		return 'on-time';
	}
</script>

<!-- The (i) metric-explainer affordance, reused inside the Schedule pane. Declared
     at the top level so the pane snippet (passed to EntityDetail) can render it. -->
{#snippet scheduleInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="route-metric-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}

<EntityDetail
	kicker={t.kicker}
	back={{ href: localizeHref('/lines', locale), label: t.back }}
	{tabs}
	bind:active
>
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
						<div class="route-section-head">
							<SectionLabel text={t.directions} variant="metric" />
							{#if live.generatedUtc != null || live.ageSeconds != null}
								<LiveFreshness
									generatedUtc={live.generatedUtc}
									ageSeconds={live.ageSeconds}
									isStale={live.isStale}
									{locale}
								/>
							{/if}
						</div>
						{#if (file.directions ?? []).length > 0}
							<ul class="route-directions">
								{#each file.directions ?? [] as dir, di (di)}
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
												{#each dir.stops ?? [] as stop, si (stop.id + '-' + si)}
													{@const prediction = predictions.get(stop.id) ?? null}
													<li class="route-stop">
														<a
															class="route-stop-link"
															href={stopHref(stop.id)}
															aria-label={t.viewStop(stop.name ?? stop.id)}
														>
															<span class="route-stop-seq">{stop.seq}</span>
															<span class="route-stop-name">{stop.name ?? stop.id}</span>
															<span class="route-stop-live">
																{#if prediction}
																	{#if prediction.etaUtc}
																		<time class="route-stop-eta" datetime={prediction.etaUtc}>
																			{timeLabel(prediction.etaUtc)}
																		</time>
																	{:else}
																		<span class="route-stop-eta">{t.approaching}</span>
																	{/if}
																	<span
																		class="route-stop-delay"
																		data-tone={delayTone(prediction.delayMin)}
																	>
																		{delayLabel(prediction.delayMin)}
																	</span>
																{:else}
																	<span class="route-stop-nolive">{t.noLiveBus}</span>
																{/if}
															</span>
															<ChevronRightIcon size={14} strokeWidth={2.4} aria-hidden="true" />
														</a>
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
								value={file.first_departure ?? '·'}
								label={t.firstDeparture}
								size="sm"
							/>
							<MetricDisplay value={file.last_departure ?? '·'} label={t.lastDeparture} size="sm" />
						</div>
						<div class="route-label-row">
							<SectionLabel text={t.servicePeriods} variant="metric" />
							{@render scheduleInfo('headway', t.servicePeriods)}
						</div>
						{#if (file.service_periods ?? []).length > 0}
							<ul class="route-periods">
								{#each file.service_periods ?? [] as sp, spi (sp.shift + '-' + spi)}
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
	.route-section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	/* A section label sitting next to its (i) metric-explainer affordance. */
	.route-label-row {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
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
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.route-stop:last-child {
		border-bottom: none;
	}
	/* Each stop is a link into its detail page: seq · name + live readout · chevron. */
	.route-stop-link {
		display: grid;
		grid-template-columns: 2ch minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.875rem;
		width: calc(100% + 1rem);
		margin-inline: -0.5rem;
		padding: 0.5rem;
		border-radius: var(--radius-sm, 0.375rem);
		color: var(--foreground);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-out);
	}
	.route-stop-seq {
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
		transition: color var(--duration-fast) var(--ease-out);
	}
	/* Live readout: soonest predicted arrival + the approaching bus's status, or
	   an honest "no live bus" placeholder when nothing is currently predicting. */
	.route-stop-live {
		grid-column: 2;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.route-stop-eta {
		font-weight: 600;
		color: var(--foreground);
	}
	.route-stop-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.route-stop-delay::before {
		content: '';
		width: 0.4rem;
		height: 0.4rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.route-stop-delay[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.route-stop-delay[data-tone='none']::before {
		display: none;
	}
	.route-stop-delay[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.route-stop-delay[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.route-stop-delay[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.route-stop-delay[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}
	.route-stop-nolive {
		color: var(--muted-foreground);
	}
	.route-stop-link :global(svg) {
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.route-stop-link:hover {
		background: color-mix(in srgb, var(--primary) 7%, transparent);
	}
	.route-stop-link:hover .route-stop-name {
		color: var(--primary);
	}
	.route-stop-link:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	.route-stop-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
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
	@media (prefers-reduced-motion: reduce) {
		.route-stop-link,
		.route-stop-name,
		.route-stop-link :global(svg) {
			transition: none;
		}
		.route-stop-link:hover :global(svg) {
			transform: none;
		}
	}
</style>
