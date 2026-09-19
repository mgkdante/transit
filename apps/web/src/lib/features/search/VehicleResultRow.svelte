<script lang="ts">
	import { localizeHref, type Locale } from '$lib/i18n';
	import { routeFor } from '$lib/nav';
	import type { Vehicle } from '$lib/v1/schemas';
	import { StatusBadge, occupancyGlyph, occupancyVar } from '$lib/components/dataviz';
	import { delayMeasurement } from '$lib/site/delayPresentation';
	import { absenceShort } from '$lib/site/absence';
	import { MaybeValue } from '$lib/components/edge';
	import type { VehicleResultCopy } from './search.copy';

	interface Props {
		vehicle: Vehicle;
		locale: Locale;
		/** Resolved next-stop name (from the stops index), or null when unresolved. */
		nextStopName: string | null;
		/** Localized status/occupancy labels + the row's intrinsic phrasing. */
		copy: VehicleResultCopy;
		/** Localized StatusCode label (e.g. "Late"). */
		statusLabel: string;
		/** Localized OccupancyCode label, or null when no telemetry. */
		occupancyLabel: string | null;
	}

	let { vehicle, locale, nextStopName, copy, statusLabel, occupancyLabel }: Props = $props();

	const href = $derived(localizeHref(routeFor({ kind: 'vehicle', id: vehicle.id }), locale));

	const delayText = $derived(delayMeasurement(vehicle.delay_min));

	// Live-tier absence reason for every omitted bus field on this row: the feed
	// carried the vehicle but left this value out → "Unknown · not reported".
	const NOT_REPORTED = 'not-reported' as const;

	// Next-stop subtitle: the RESOLVED stop name only. An unresolved/omitted id
	// falls to the styled honest-absence chip ("Unknown · not reported") — we never
	// surface the raw GTFS id ("Next: 99999"), which is meaningless to a rider.
	const nextStop = $derived(nextStopName);

	// Heading arrow: a north-up glyph rotated by the GTFS bearing (0°=N). Absent
	// bearing → no arrow (no fabricated heading).
	const hasBearing = $derived(vehicle.bearing != null);

	const occGlyph = $derived(occupancyGlyph(vehicle.occupancy));
	const occColor = $derived(
		vehicle.occupancy ? occupancyVar(vehicle.occupancy) : 'var(--muted-foreground)',
	);
</script>

<a
	{href}
	data-sveltekit-preload-data="hover"
	class="vehicle-row"
	data-slot="vehicle-result"
	aria-label={`${copy.busAria(vehicle.id)}, ${statusLabel}, ${copy.delay}: ${delayText ?? absenceShort(NOT_REPORTED, locale)}`}
>
	<span class="vehicle-row-lead">
		{#if hasBearing}
			<span
				class="vehicle-row-arrow"
				style="transform: rotate({vehicle.bearing}deg);"
				role="img"
				aria-label={copy.heading}
			>
				↑
			</span>
		{:else}
			<span class="vehicle-row-glyph" aria-hidden="true">▣</span>
		{/if}
	</span>

	<span class="vehicle-row-body">
		<span class="vehicle-row-title">
			<span class="vehicle-row-id">{vehicle.id}</span>
			{#if vehicle.route}
				<span class="vehicle-row-route">{copy.routeTag(vehicle.route)}</span>
			{/if}
		</span>
		<span class="vehicle-row-sub">
			<MaybeValue present={nextStop != null} reason={NOT_REPORTED} {locale}>
				{copy.next(nextStop ?? '')}
			</MaybeValue>
		</span>
		<span class="vehicle-row-marks">
			<StatusBadge status={vehicle.status} mode="pill" size="sm" label={statusLabel} />
			<MaybeValue present={occupancyLabel != null} reason={NOT_REPORTED} {locale}>
				<span class="vehicle-row-crowd" style="--occ:{occColor};" title={occupancyLabel}>
					<span class="vehicle-row-crowd-glyph" aria-hidden="true">{occGlyph}</span>
					<span class="vehicle-row-crowd-label">{occupancyLabel}</span>
				</span>
			</MaybeValue>
		</span>
	</span>

	<span class="vehicle-row-meta">
		<MaybeValue value={delayText} reason={NOT_REPORTED} {locale} />
	</span>
</a>

<style>
	.vehicle-row {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem 0.875rem;
		border-radius: var(--radius-md);
		color: var(--foreground);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-default);
	}
	.vehicle-row:hover {
		background-color: var(--muted);
	}
	.vehicle-row:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.vehicle-row-lead {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
	}
	/* The heading arrow is an interactive entity's affordance glyph — it rides the
	   --primary accent (the bus's identity colour on the map), not a data mark. */
	.vehicle-row-arrow {
		font-size: var(--text-subheading);
		line-height: 1;
		color: var(--primary);
		transition: transform var(--duration-fast) var(--ease-out);
	}
	.vehicle-row-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-subheading);
		line-height: 1;
		color: var(--primary);
	}
	.vehicle-row-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1 1 auto;
		min-width: 0;
	}
	.vehicle-row-title {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}
	.vehicle-row-id {
		font-family: var(--font-heading);
		font-weight: 600;
		font-size: var(--text-body);
	}
	.vehicle-row-route {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.vehicle-row-sub {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.vehicle-row-marks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem 0.5rem;
		margin-top: 0.125rem;
	}
	.vehicle-row-crowd {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	/* The crowding glyph carries the occupancy band on the dataviz occupancy scale
	   (luminance + a fill glyph — a double channel; never --primary). */
	.vehicle-row-crowd-glyph {
		color: var(--occ);
		line-height: 1;
	}
	.vehicle-row-meta {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		.vehicle-row,
		.vehicle-row-arrow {
			transition: none;
		}
	}
</style>
