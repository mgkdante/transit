<!--
  TripDetail — the standalone per-trip detail surface (slice-9.4).

  Composes the surface spine: a SurfaceHeader over the trip's route link, status
  band, current delay and ordered remaining-stop ETA list. The trip is looked up
  from the live trips map (getTrips → TripsFile.trips[id]) via createResource,
  gated by a ResourceBoundary so skeleton / error render without bespoke plumbing.

  HONESTY: a trip is an EPHEMERAL live entity (ids rotate). When the trip is
  absent from the broadcast, or getTrips returns no entry, the surface STANDS
  DOWN with a localized "not broadcasting" note rather than fabricating a trip.
  Each remaining-stop ETA is framed as a LIVE PREDICTION with its delay-from-
  schedule basis (delay_min) — never a guarantee, never a fabricated confidence.
  A null delay renders an honest "no data", never 0.

  Reads locale via getLocale(); copy is co-located in trips.copy.ts. Tokens only;
  --primary stays interactive-only.
-->
<script lang="ts">
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { mapHrefFor, routeFor } from '$lib/nav';
	import { getTrips, getStopsIndex, getV1Context } from '$lib/v1';
	import type { TripsFile, Trip, StatusCode, StopsIndex } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { Surface } from '$lib/components/layout';
	import { ResourceBoundary, SurfaceHeader, FreshnessStamp } from '$lib/components/surface';
	import Breadcrumb from '$lib/components/surface/Breadcrumb.svelte';
	import type { BreadcrumbTrailItem } from '$lib/seo/routeSeo';
	import { Separator } from '$lib/components/ui/separator';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import MapDrilldownLink from '$lib/components/surface/MapDrilldownLink.svelte';
	import { MaybeValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, metricName } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { formatUtc } from '$lib/utils/time';
	import { delayTone, delayLabel } from '$lib/site/delayPresentation';
	import { tripCopy } from './trips.copy';

	interface TripDetailProps {
		/** The trip id from the route param. */
		id: string;
	}

	let { id }: TripDetailProps = $props();

	const locale: Locale = getLocale();
	const t = $derived(tripCopy[locale]);

	// The metric-explainer (i) affordance (§C5.15): a one-line tip + a deep link into
	// /metrics#<anchor>, wired onto the verdict chip (delay) + the ETA list (ETA basis).
	const explainerCopy = $derived(metricsCopy[locale]);
	const delayInfo = $derived.by(() => {
		const i = metricInfoFor('avgDelay', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(metricName('avgDelay', locale)),
			linkLabel: explainerCopy.info.link,
		};
	});

	// Visible breadcrumb for wayfinding (H4). Trip has no index route AND is noindex
	// (ids rotate), so the trail is built INLINE here — Home > Trip {id} — and stays
	// OUT of resolveBreadcrumbTrail so the SEO BreadcrumbList never lists a noindex
	// page. Paths are delocalized (the Breadcrumb contract); it localizes each href.
	const trail = $derived<BreadcrumbTrailItem[]>([
		{ name: t.crumbHome, path: '/' },
		{ name: t.heading(id), path: `/trip/${encodeURIComponent(id)}` },
	]);

	// The whole live trips map (trip-keyed). One read, reactive to `id`. We look up
	// THIS trip below; an absent entry is the honest "not broadcasting" signal.
	// `freshness: true` contributes the live build's generated_utc to the shared
	// site-wide newest-data timestamp (the live store still owns it authoritatively;
	// this surface doesn't mount the store, so it pitches in monotonically).
	const trips = createResource<TripsFile | null>(() => getTrips(), { freshness: true });

	/** This trip, or null when the broadcast carries no entry for it (stand-down). */
	const trip = $derived<Trip | null>(trips.data?.trips?.[id] ?? null);

	// Supplementary stops index — client-side, fail-soft (a 404 / failed fetch just
	// leaves raw ids). Used ONLY to resolve a stop-id to its human name (§C5.15); the
	// surface renders fully without it, so it never blocks the trip.
	const stopsIndex = createResource<StopsIndex | null>(() => getStopsIndex());
	const stopNameById = $derived.by<Record<string, string>>(() => {
		const m: Record<string, string> = {};
		for (const s of stopsIndex.data?.stops ?? []) m[s.id] = s.name;
		return m;
	});
	/** A stop-id resolved to its name, or the raw id when the index has no entry. */
	const stopNameFor = (stopId: string): string => stopNameById[stopId] ?? stopId;

	// Destination + progress (§C5.15) from the remaining-stop ETA list: the destination
	// is the LAST remaining stop (resolved to a name); "N stops remaining" is the count
	// of the served list. Honest: the feed carries only REMAINING stops, so we never
	// fabricate a total-stop denominator — we report what the broadcast actually gives.
	const remainingStops = $derived(trip?.stops ?? []);
	const remainingCount = $derived(remainingStops.length);
	const destinationName = $derived.by<string | null>(() => {
		const last = remainingStops[remainingStops.length - 1];
		return last ? stopNameFor(last.stop) : null;
	});

	const routeHref = (routeId: string): string =>
		localizeHref(routeFor({ kind: 'line', id: routeId }), locale);

	const stopHref = (stopId: string): string =>
		localizeHref(routeFor({ kind: 'stop', id: stopId }), locale);

	const timeLabel = (iso: string): string =>
		formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false });

	// Freshness off the live file's build timestamp. The FreshnessStamp computes its
	// server-anchored, shared-tick age centrally — no per-page age math here.
	const generatedUtc = $derived(trips.data?.generated_utc ?? null);

	// CornerMeta readouts (A4) — REAL data only: provider (always, from the manifest)
	// + the live-tier generated stamp; a missing datum drops its corner (never
	// fabricated). Corners annotate the LIVE head only (the stand-down branch has no
	// broadcasting trip to frame).
	const manifest = getV1Context().manifest;
	const cm = cornerMetaLabels[locale];
	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const cornerGeneratedStamp = $derived(
		generatedUtc != null ? formatUtc(generatedUtc, locale) : null,
	);

	/** Localized status-band label for the v1 StatusCode. */
	function statusLabel(status: StatusCode): string {
		return t.status[status] ?? t.status.unknown;
	}

	// delayTone + delayLabel are the site-wide shared helpers ($lib/site/
	// delayPresentation); a null/absent delay is handled at the call site by the
	// styled honest-absence chip (AbsentValue), so delayLabel's null branch falls
	// back to the trip copy's noDelay only as a defensive guard.

	/**
	 * The CHIP's tone. Derived from the server StatusCode (the SAME source the
	 * StatusDot reads) so the dot and the delay chip never disagree in colour — an
	 * amber dot beside a red chip would be incoherent. The chip's TEXT still reads
	 * the raw delay_min honestly; only its colour follows the authoritative band.
	 * Falls back to delayTone(delay_min) only if a Trip ever omits status.
	 */
	function chipTone(
		status: StatusCode | null | undefined,
		delay: number | null | undefined,
	): string {
		switch (status) {
			case 'early':
				return 'early';
			case 'on_time':
				return 'on-time';
			case 'late':
				return 'late';
			case 'severe':
				return 'severe';
			case 'unknown':
				return 'none';
			default:
				return delayTone(delay);
		}
	}
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

<Surface as="div" data-slot="trip-detail">
	<ResourceBoundary resource={trips} lang={locale}>
		{#snippet children(_file)}
			<!-- Wayfinding breadcrumb (H4): Home > Trip {id}. Carried on both the
			     stand-down and the live branch so the trail is stable across states. -->
			<Breadcrumb {trail} {locale} />
			{#if trip == null}
				<!-- HONEST stand-down: the broadcast carries no entry for this trip id.
				     Trip ids rotate, so this is the expected path for a stale deep link —
				     a localized note, never a fabricated trip. -->
				<div class="trip-standdown" data-testid="trip-standdown">
					<SectionLabel text={t.kicker} variant="station" />
					<!-- D1: the stand-down head is display-type + the orange terminal dot,
					     the same head treatment the live branch carries via SurfaceHeader. -->
					<SectionHeading heading={t.standDownHeading} level={1} dot />
					<p class="trip-standdown-body">{t.standDownBody}</p>
				</div>
			{:else}
				<!-- A4: the live head is the relative host for the CornerMeta corners
				     (provider · generated · trip id — real data from the manifest + live
				     tier). aria-hidden, hidden < 768px. -->
				<div class="trip-head">
					<CornerMeta>
						{#snippet topLeft()}<span class="trip-corner">{cm.trip} · {id}</span>{/snippet}
						{#snippet topRight()}{#if cornerGeneratedStamp}<span class="trip-corner"
									>{cm.generated} · {cornerGeneratedStamp}</span
								>{/if}{/snippet}
						{#snippet bottomLeft()}<span class="trip-corner">{cm.provider} · {shortName}</span
							>{/snippet}
					</CornerMeta>
					<SurfaceHeader
						kicker={t.kicker}
						heading={t.heading(id)}
						subheading={t.subheading}
						lede={t.lede}
					>
						<div class="trip-head-actions">
							{#if generatedUtc != null}
								<FreshnessStamp variant="live" {generatedUtc} isStale={false} {locale} />
							{/if}
							<MapDrilldownLink
								href={mapHrefFor({ trip: id }, locale)}
								label={t.viewOnMap}
								ariaLabel={t.viewTripOnMap(id)}
							/>
						</div>
					</SurfaceHeader>
				</div>

				<Separator variant="hazard" />

				<div class="trip-body">
					<!-- ONE merged verdict chip (§C5.15): status band + current delay in a single
					     signal (they were two duplicate cells) + the destination/progress + the
					     line context link-back. -->
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
							<!-- The dot is the COLOUR channel; the status word is the text channel
							     (colour never the sole channel). The delay reading rides the SAME chip
							     so the verdict reads as one signal, not two. A null delay stands down
							     to the styled honest-absence chip, never a fabricated 0. -->
							<span class="trip-verdict">
								<StatusDot color={trip.status} />
								<span class="trip-status-label">{statusLabel(trip.status)}</span>
								<MaybeValue present={trip.delay_min != null} reason="not-reported" {locale}>
									<span
										class="trip-verdict-delay"
										data-tone={chipTone(trip.status, trip.delay_min)}
									>
										{delayLabel(trip.delay_min, t)}
									</span>
								</MaybeValue>
							</span>
						</div>

						<!-- Destination + progress from the remaining-stop ETA list. -->
						{#if destinationName != null}
							<div class="trip-summary-cell">
								<SectionLabel text={t.destinationHeading} variant="metric" />
								<span class="trip-destination">
									<span class="trip-destination-name">{destinationName}</span>
									<span class="trip-destination-progress">{t.stopsRemaining(remainingCount)}</span>
								</span>
							</div>
						{/if}

						<!-- Line context link-back. -->
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

					<!-- Remaining-stop ETA list, framed as a LIVE PREDICTION. The delay (i)
					     rides the section heading (the ETA basis is the same delay metric). -->
					<div class="trip-stops-section">
						<SectionHeading level={2} overline={t.remainingStops} explainer={etaInfo} />
						{#if remainingStops.length > 0}
							<ol class="trip-stops" aria-label={t.stopsListLabel}>
								{#each remainingStops as stop, si (stop.stop + '-' + si)}
									<li class="trip-stop">
										<a
											class="trip-stop-link"
											href={stopHref(stop.stop)}
											aria-label={t.viewStop(stopNameFor(stop.stop))}
										>
											<!-- Raw stop-id resolved to its human name via the stops repo
											     (client-side, fail-soft to the id when unresolved). -->
											<span class="trip-stop-name">{stopNameFor(stop.stop)}</span>
											<span class="trip-stop-live">
												<time class="trip-stop-eta" datetime={stop.eta_utc}>
													{timeLabel(stop.eta_utc)}
												</time>
												<span class="trip-stop-prediction">{t.predictionLabel}</span>
												<!-- Live prediction: render the delay basis, else the styled honest-
												     absence chip when no basis, never a plain "no data" that reads
												     like a real value. -->
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
							<p class="trip-prediction-caveat">{t.predictionCaveat}</p>
						{:else}
							<!-- Trip is broadcasting but reports no remaining stops: an honest
							     note rather than a fabricated empty list. -->
							<p class="trip-novalue" data-testid="trip-no-stops">{t.noRemainingStops}</p>
						{/if}
					</div>
				</div>
			{/if}
		{/snippet}
	</ResourceBoundary>
</Surface>

<style>
	/* A4: the live head hosts the CornerMeta corners; a top margin band (only where
	   the corners surface, >=768px) keeps them clear of the kicker/heading flow. */
	.trip-head {
		position: relative;
	}
	@media (min-width: 768px) {
		.trip-head {
			padding-top: 1.5rem;
		}
	}
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
		max-width: 52ch;
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
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
		/* Tap-target floor (P5.3d §C4 P10): the line-context link-back was 29px tall. */
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
	/* The cell head aligns the SectionLabel with its (i) affordance inline. */
	.trip-cell-head {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	/* The merged verdict chip: status dot + status word + delay reading as ONE signal. */
	.trip-verdict {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.trip-status-label {
		font-size: var(--text-body);
		color: var(--foreground);
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
	.trip-verdict-delay::before {
		content: '';
		width: 0.375rem;
		height: 0.375rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.trip-verdict-delay[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.trip-verdict-delay[data-tone='none']::before {
		display: none;
	}
	.trip-verdict-delay[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.trip-verdict-delay[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.trip-verdict-delay[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.trip-verdict-delay[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}
	/* Destination + progress: the last remaining stop's name over the remaining count. */
	.trip-destination {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.trip-destination-name {
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--foreground);
	}
	.trip-destination-progress {
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
	.trip-stop-live {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.trip-stop-eta {
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
	.trip-novalue {
		color: var(--muted-foreground);
		font-size: var(--text-body);
	}
	.trip-prediction-caveat {
		margin: 0.5rem 0 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
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
