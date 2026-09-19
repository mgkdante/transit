<!-- Trip IDs may expire. ETA values are predictions; missing delays remain unknown. -->
<script lang="ts">
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { mapHrefFor, routeFor } from '$lib/nav';
	import { createLiveResource } from '$lib/v1/live/resource';
	import { getStopsIndex } from '$lib/v1/repositories/static';
	import { getV1Context } from '$lib/v1/boot';
	import type { Trip, StopsIndex } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { Surface } from '$lib/components/layout';
	import { ResourceBoundary, FreshnessStamp } from '$lib/components/surface';
	import Breadcrumb from '$lib/components/surface/Breadcrumb.svelte';
	import type { BreadcrumbTrailItem } from '$lib/seo/routeSeo';
	import { SectionLabel } from '@yesid/ui/brand';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import Masthead from '$lib/components/brand/Masthead.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import { StatusBadge } from '$lib/components/dataviz';
	import MapDrilldownLink from '$lib/components/surface/MapDrilldownLink.svelte';
	import { MaybeValue, StateNotice } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, metricName } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { formatUtc } from '$lib/utils/time';
	import { delayMeasurement, delayTone, delayLabel } from '$lib/site/delayPresentation';
	import { tripCopy } from './trips.copy';

	interface TripDetailProps {
		id: string;
	}

	let { id }: TripDetailProps = $props();

	const locale: Locale = getLocale();
	const t = $derived(tripCopy[locale]);
	const explainerCopy = $derived(metricsCopy[locale]);
	const delayInfo = $derived.by(() => {
		const i = metricInfoFor('avgDelay', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(metricName('avgDelay', locale)),
			linkLabel: explainerCopy.info.link,
		};
	});
	// Trip links are noindex; keep this UI trail outside the indexed SEO breadcrumbs.
	// Breadcrumb localizes these delocalized paths.
	const trail = $derived<BreadcrumbTrailItem[]>([
		{ name: t.crumbHome, path: '/' },
		{ name: t.heading(id), path: `/trip/${encodeURIComponent(id)}` },
	]);
	const manifest = getV1Context().manifest;
	const { live, resource: trips } = createLiveResource(manifest, 'trips');
	const reportState = $derived(live.familyStates.trips);
	const reportFailed = $derived(reportState.consecutiveFailures > 0);

	const trip = $derived<Trip | null>(trips.data?.trips?.[id] ?? null);
	const unknownStatusAndDelay = $derived(trip?.status === 'unknown' && trip.delay_min == null);
	// A failed optional stop-name lookup preserves the raw stop IDs.
	const stopsIndex = createResource<StopsIndex | null>(() => getStopsIndex());
	const stopNameById = $derived.by<Record<string, string>>(() => {
		const m: Record<string, string> = {};
		for (const s of stopsIndex.data?.stops ?? []) m[s.id] = s.name;
		return m;
	});

	const stopNameFor = (stopId: string): string => stopNameById[stopId] ?? stopId;
	// The report is capped at one hour; its last row does not establish the terminal.
	const reportedPredictions = $derived(trip?.stops ?? []);
	const predictionCount = $derived(reportedPredictions.length);
	const lastReportedStopName = $derived.by<string | null>(() => {
		const last = reportedPredictions[reportedPredictions.length - 1];
		return last ? stopNameFor(last.stop) : null;
	});

	const routeHref = (routeId: string): string =>
		localizeHref(routeFor({ kind: 'line', id: routeId }), locale);

	const stopHref = (stopId: string): string =>
		localizeHref(routeFor({ kind: 'stop', id: stopId }), locale);

	const timeLabel = (iso: string): string =>
		formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false });
	const generatedUtc = $derived(live.generatedUtc);
	const cm = cornerMetaLabels[locale];
	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const cornerGeneratedStamp = $derived(
		generatedUtc != null ? formatUtc(generatedUtc, locale) : null,
	);
</script>

{#snippet etaInfo()}
	<MetricInfo
		tip={delayInfo.tip}
		href={delayInfo.href}
		label={delayInfo.label}
		linkLabel={delayInfo.linkLabel}
		side="bottom"
	/>
{/snippet}

{#snippet reportFreshness()}
	<FreshnessStamp
		variant="live"
		{generatedUtc}
		ageSeconds={live.ageSeconds}
		isStale={live.isStale}
		degraded={reportFailed}
		class="trip-report-stamp"
		label={t.latestReport}
		{locale}
	/>
{/snippet}

<Surface as="div" data-slot="trip-detail">
	<ResourceBoundary resource={trips} lang={locale}>
		{#snippet children(_file)}
			<Breadcrumb {trail} {locale} />
			{#if reportFailed || live.isStale}
				<StateNotice
					title={reportFailed ? t.refreshUnavailable : t.reportBehind}
					body={t.retainedReport}
					tone="warning"
					presentation="silo"
					role="status"
					ariaLive="polite"
					data-testid="trip-report-notice"
				/>
			{/if}
			{#if trip == null}
				<div class="trip-standdown" data-testid="trip-standdown">
					<SectionLabel text={t.kicker} variant="station" />

					<SectionHeading heading={t.standDownHeading} level={1} dot />
					<p class="trip-standdown-body">{t.standDownBody}</p>
					{@render reportFreshness()}
				</div>
			{:else}
				<Masthead kicker={t.kicker} heading={t.heading(id)} subheading={t.subheading}>
					{#snippet cornerMeta()}
						<CornerMeta>
							{#snippet topLeft()}<span class="trip-corner">{cm.trip} · {id}</span>{/snippet}
							{#snippet topRight()}{#if cornerGeneratedStamp}<span class="trip-corner"
										>{cm.generated} · {cornerGeneratedStamp}</span
									>{/if}{/snippet}
							{#snippet bottomLeft()}<span class="trip-corner">{cm.provider} · {shortName}</span
								>{/snippet}
						</CornerMeta>
					{/snippet}
					{#snippet meta()}
						<div class="trip-head-actions">
							{#if generatedUtc != null}
								{@render reportFreshness()}
							{/if}
							<MapDrilldownLink
								href={mapHrefFor({ trip: id }, locale)}
								label={t.viewOnMap}
								ariaLabel={t.viewTripOnMap(id)}
							/>
						</div>
					{/snippet}
				</Masthead>

				<div class="trip-body">
					<div class="trip-summary">
						<div class="trip-summary-cell">
							<span class="trip-cell-head">
								<SectionLabel text={t.verdictHeading} variant="metric" />
								<MetricInfo
									tip={delayInfo.tip}
									href={delayInfo.href}
									label={delayInfo.label}
									linkLabel={delayInfo.linkLabel}
									side="bottom"
								/>
							</span>

							<span class="trip-verdict">
								<StatusBadge
									status={trip.status}
									label={t.status[trip.status]}
									mode={unknownStatusAndDelay ? 'dot' : 'legend'}
									aria-hidden={unknownStatusAndDelay || undefined}
								/>
								<span class="trip-verdict-delay">
									<MaybeValue
										value={delayMeasurement(trip.delay_min)}
										variant={unknownStatusAndDelay ? 'row' : 'inline'}
										reason="not-reported"
										{locale}
									/>
								</span>
							</span>
						</div>

						{#if lastReportedStopName != null}
							<div class="trip-summary-cell">
								<SectionLabel text={t.lastReportedStop} variant="metric" />
								<span class="trip-last-stop">
									<span class="trip-last-stop-name">{lastReportedStopName}</span>
									<span class="trip-prediction-count">{t.predictionCount(predictionCount)}</span>
								</span>
							</div>
						{/if}

						<div class="trip-summary-cell">
							<SectionLabel text={t.route} variant="metric" />
							<MaybeValue present={trip.route != null} reason="not-reported" {locale}>
								<a
									class="trip-route-link"
									href={routeHref(trip.route!)}
									aria-label={t.viewRoute(trip.route!)}
								>
									<span class="trip-route-code">{trip.route}</span>
									<ChevronRightIcon size={14} strokeWidth={2.4} aria-hidden="true" />
								</a>
							</MaybeValue>
						</div>
					</div>

					<div class="trip-stops-section">
						<SectionHeading level={2} overline={t.reportedPredictions} explainer={etaInfo} />
						{#if reportedPredictions.length > 0}
							<ol class="trip-stops" aria-label={t.stopsListLabel}>
								{#each reportedPredictions as stop, si (stop.stop + '-' + si)}
									<li class="trip-stop">
										<a
											class="trip-stop-link"
											href={stopHref(stop.stop)}
											aria-label={t.viewStop(stopNameFor(stop.stop))}
										>
											<span class="trip-stop-name">{stopNameFor(stop.stop)}</span>
											<span class="trip-stop-meta">
												<time class="trip-stop-eta" datetime={stop.eta_utc}>
													{timeLabel(stop.eta_utc)}
												</time>
												<span class="trip-stop-prediction">{t.predictionLabel}</span>

												<MaybeValue present={stop.delay_min != null} reason="not-reported" {locale}>
													<span class="trip-stop-delay" data-tone={delayTone(stop.delay_min)}>
														{delayLabel(stop.delay_min, t)}
													</span>
												</MaybeValue>
											</span>
											<ChevronRightIcon size={14} strokeWidth={2.4} aria-hidden="true" />
										</a>
									</li>
								{/each}
							</ol>
						{:else}
							<StateNotice
								title={t.noPredictions}
								presentation="silo"
								role="status"
								ariaLive="polite"
								data-testid="trip-no-stops"
							/>
						{/if}
						<p class="trip-prediction-caveat">{t.predictionCaveat}</p>
					</div>
				</div>
			{/if}
		{/snippet}
	</ResourceBoundary>
</Surface>

<style>
	/* Masthead owns the responsive spacing around these decorative corners. */
	.trip-corner {
		white-space: nowrap;
	}
	.trip-standdown {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.trip-standdown-body {
		margin: 0;
		max-width: var(--measure-lede);
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
	}

	:global(.trip-report-stamp) {
		max-width: 100%;
		flex-wrap: wrap;
	}
	:global(.trip-report-stamp > *) {
		white-space: nowrap;
	}

	.trip-head-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
	}

	.trip-body {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.trip-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2.5rem;
	}
	.trip-summary-cell {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.trip-route-link {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;

		/* Preserve the shared touch-target floor. */
		min-height: var(--size-tap-min);
		text-decoration: none;
		color: var(--foreground);
		transition: color var(--duration-fast) var(--ease-out);
	}
	.trip-route-code {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: var(--text-subheading);
		color: var(--accent-text);
	}
	.trip-route-link :global(svg) {
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.trip-route-link:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	.trip-route-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.trip-cell-head {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.trip-verdict {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.trip-verdict-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: var(--text-body);
		color: var(--muted-foreground);
	}

	.trip-last-stop {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.trip-last-stop-name {
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--foreground);
	}
	.trip-prediction-count {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}

	.trip-stops-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.trip-stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.trip-stop {
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.trip-stop:last-child {
		border-bottom: none;
	}
	.trip-stop-link {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.875rem;
		width: calc(100% + 1rem);
		margin-inline: -0.5rem;
		padding: 0.625rem 0.5rem;
		border-radius: var(--radius-sm);
		color: var(--foreground);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-out);
	}
	.trip-stop-name {
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease-out);
	}
	.trip-stop-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.trip-stop-eta {
		white-space: nowrap;
		font-weight: 600;
		color: var(--foreground);
	}
	.trip-stop-prediction {
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
	}
	.trip-stop-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.trip-stop-delay::before {
		content: '';
		width: 0.375rem;
		height: 0.375rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.trip-stop-delay[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.trip-stop-delay[data-tone='none']::before {
		display: none;
	}
	.trip-stop-delay[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.trip-stop-delay[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.trip-stop-delay[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.trip-stop-delay[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}
	.trip-stop-link :global(svg) {
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.trip-stop-link:hover {
		background: color-mix(in srgb, var(--primary) 7%, transparent);
	}
	.trip-stop-link:hover .trip-stop-name {
		color: var(--primary);
	}
	.trip-stop-link:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	.trip-stop-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.trip-prediction-caveat {
		margin: 0.5rem 0 0;
		max-width: var(--measure-body);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	@media (max-width: 40rem) {
		.trip-stop-link {
			grid-template-columns: minmax(0, 1fr) auto;
			row-gap: 0.375rem;
		}
		.trip-stop-name {
			grid-column: 1;
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.trip-stop-meta {
			grid-column: 1;
			min-width: 0;
			flex-wrap: wrap;
		}
		.trip-stop-link :global(svg) {
			grid-column: 2;
			grid-row: 1 / span 2;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.trip-route-link,
		.trip-route-link :global(svg),
		.trip-stop-link,
		.trip-stop-name,
		.trip-stop-link :global(svg) {
			transition: none;
		}
		.trip-route-link:hover :global(svg),
		.trip-stop-link:hover :global(svg) {
			transform: none;
		}
	}
</style>
