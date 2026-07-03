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
	import { getTrips } from '$lib/v1';
	import type { TripsFile, Trip, StatusCode } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { Surface } from '$lib/components/layout';
	import { ResourceBoundary, SurfaceHeader, FreshnessStamp } from '$lib/components/surface';
	import Breadcrumb from '$lib/components/surface/Breadcrumb.svelte';
	import type { BreadcrumbTrailItem } from '$lib/seo/routeSeo';
	import { Separator } from '$lib/components/ui/separator';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import MapDrilldownLink from '$lib/components/surface/MapDrilldownLink.svelte';
	import { MaybeValue } from '$lib/components/edge';
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

	const routeHref = (routeId: string): string =>
		localizeHref(routeFor({ kind: 'line', id: routeId }), locale);

	const stopHref = (stopId: string): string =>
		localizeHref(routeFor({ kind: 'stop', id: stopId }), locale);

	const timeLabel = (iso: string): string =>
		formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false });

	// Freshness off the live file's build timestamp. The FreshnessStamp computes its
	// server-anchored, shared-tick age centrally — no per-page age math here.
	const generatedUtc = $derived(trips.data?.generated_utc ?? null);

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
					<h1 class="trip-standdown-heading">{t.standDownHeading}</h1>
					<p class="trip-standdown-body">{t.standDownBody}</p>
				</div>
			{:else}
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

				<Separator variant="hazard" />

				<div class="trip-body">
					<!-- Route link + status + current delay. -->
					<div class="trip-summary">
						<div class="trip-summary-cell">
							<SectionLabel text={t.route} variant="metric" />
							<!-- Broadcasting trip: render the route link, else the styled honest-absence
							     chip (the live feed omitted the route), never a plain grey note. -->
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

						<div class="trip-summary-cell">
							<SectionLabel text={t.statusHeading} variant="metric" />
							<span class="trip-status">
								<!-- The dot is the COLOUR channel; the adjacent visible label is the
								     text channel (colour never the sole channel). No sr-only label on
								     the dot so the status name is not announced twice. -->
								<StatusDot color={trip.status} />
								<span class="trip-status-label">{statusLabel(trip.status)}</span>
							</span>
						</div>

						<div class="trip-summary-cell">
							<SectionLabel text={t.delayLabel} variant="metric" />
							<!-- Broadcasting trip: render the delay reading, else the styled honest-
							     absence chip ("Unknown · not reported in the live feed") when the live
							     feed omitted delay_min, never an easy-to-miss plain note, never a 0. -->
							<MaybeValue present={trip.delay_min != null} reason="not-reported" {locale}>
								<span class="trip-delay" data-tone={chipTone(trip.status, trip.delay_min)}>
									{delayLabel(trip.delay_min, t)}
								</span>
							</MaybeValue>
						</div>
					</div>

					<!-- Remaining-stop ETA list, framed as a LIVE PREDICTION. -->
					<div class="trip-stops-section">
						<SectionHeading level={2} overline={t.remainingStops} />
						{#if (trip.stops ?? []).length > 0}
							<ol class="trip-stops" aria-label={t.stopsListLabel}>
								{#each trip.stops ?? [] as stop, si (stop.stop + '-' + si)}
									<li class="trip-stop">
										<a
											class="trip-stop-link"
											href={stopHref(stop.stop)}
											aria-label={t.viewStop(stop.stop)}
										>
											<span class="trip-stop-name">{stop.stop}</span>
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
	.trip-standdown {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.trip-standdown-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-weight: 600;
		font-size: var(--text-heading);
		color: var(--foreground);
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
		gap: 0.4rem;
	}
	.trip-route-link {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
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
	.trip-status {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.trip-status-label {
		font-size: var(--text-body);
		color: var(--foreground);
	}
	.trip-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: var(--text-body);
		color: var(--muted-foreground);
	}
	.trip-delay::before {
		content: '';
		width: 0.45rem;
		height: 0.45rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.trip-delay[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.trip-delay[data-tone='none']::before {
		display: none;
	}
	.trip-delay[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.trip-delay[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.trip-delay[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.trip-delay[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}

	.trip-stops-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
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
		border-radius: var(--radius-sm, 0.375rem);
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
		gap: 0.3rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.trip-stop-delay::before {
		content: '';
		width: 0.4rem;
		height: 0.4rem;
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
