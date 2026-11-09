<script lang="ts">
	import TransitEntityRow from '#lib/components/surface/TransitEntityRow.svelte';
	import { stopDisplayName } from '#lib/site/transitDisplay.ts';
	import { transitDisplay } from '#lib/site/transitDisplayContext.ts';
	const { line } = transitDisplay();
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { routeFor } from '#lib/nav/index.ts';
	import type { Vehicle } from '#lib/v1/schemas/index.ts';
	import { StatusBadge, occupancyGlyph, occupancyVar } from '#lib/components/dataviz/index.ts';
	import { delayMeasurement } from '#lib/site/delayPresentation.ts';
	import { notReporting } from '#lib/features/map/vehicleMotion.ts';
	import { getV1Runtime } from '#lib/v1/runtime.ts';
	import { onMount } from 'svelte';
	import { absenceSentence } from '#lib/site/absence.ts';
	import { MaybeValue } from '#lib/components/edge/index.ts';
	import type { VehicleResultCopy } from './search.copy';

	const localizeHref = getLocalizeHref();

	interface Props {
		vehicle: Vehicle;
		locale: Locale;
		nextStopName: string | null;
		copy: VehicleResultCopy;
		statusLabel: string;
		occupancyLabel: string | null;
		occupancyAvailable?: boolean;
	}

	let {
		occupancyAvailable = true,
		vehicle,
		locale,
		nextStopName,
		copy,
		statusLabel,
		occupancyLabel,
	}: Props = $props();

	const href = $derived(localizeHref(routeFor({ kind: 'vehicle', id: vehicle.id }), locale));

	const unknownStatusAndDelay = $derived(vehicle.status === 'unknown' && vehicle.delay_min == null);
	const delayText = $derived(delayMeasurement(vehicle.delay_min));

	const runtime = getV1Runtime();
	onMount(() => runtime.clock.subscribe());
	const absence = $derived(
		notReporting(vehicle, runtime.clock.serverNow) ? 'not-reporting' : 'not-reported',
	);

	const nextStop = $derived(nextStopName == null ? null : stopDisplayName(nextStopName));

	const hasBearing = $derived(vehicle.bearing != null);

	const occGlyph = $derived(occupancyGlyph(vehicle.occupancy));
	const occColor = $derived(
		vehicle.occupancy ? occupancyVar(vehicle.occupancy) : 'var(--muted-foreground)',
	);
</script>

<TransitEntityRow
	presentation="legacy-vehicle"
	{href}
	ariaLabel={`${copy.busAria(vehicle.id)}, ${unknownStatusAndDelay ? '' : `${statusLabel}, `}${copy.delay}: ${delayText ?? absenceSentence(absence, locale)}`}
>
	{#snippet leading()}
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
	{/snippet}
	{#snippet identity()}
		<span class="vehicle-row-body">
			<span class="vehicle-row-title">
				<span class="vehicle-row-id">{vehicle.id}</span>
				{#if vehicle.route}
					<span class="vehicle-row-route">{copy.routeTag(line(vehicle.route))}</span>
				{/if}
			</span>
			<span class="vehicle-row-sub">
				<MaybeValue present={nextStop != null} reason={absence} {locale}>
					{copy.next(nextStop ?? '')}
				</MaybeValue>
			</span>
			<span class="vehicle-row-marks">
				<StatusBadge
					status={vehicle.status}
					mode={unknownStatusAndDelay ? 'dot' : 'pill'}
					aria-hidden={unknownStatusAndDelay || undefined}
					size="sm"
					label={statusLabel}
				/>
				{#if occupancyAvailable}<MaybeValue
						present={occupancyLabel != null}
						reason={absence}
						{locale}
					>
						<span class="vehicle-row-crowd" style="--occ:{occColor};" title={occupancyLabel}>
							<span class="vehicle-row-crowd-glyph" aria-hidden="true">{occGlyph}</span>
							<span class="vehicle-row-crowd-label">{occupancyLabel}</span>
						</span>
					</MaybeValue>{/if}
			</span>
		</span>
	{/snippet}
	{#snippet metadata()}
		<span class="vehicle-row-meta">
			<MaybeValue
				value={delayText}
				reason={absence}
				variant={unknownStatusAndDelay ? 'row' : 'inline'}
				{locale}
			/>
		</span>
	{/snippet}
</TransitEntityRow>

<style>
	.vehicle-row-lead {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
	}
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
		.vehicle-row-arrow {
			transition: none;
		}
	}
</style>
