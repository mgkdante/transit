<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import { isInService, vehicleServiceCopy } from '#lib/v1/live/vehicleService.ts';
	import { transitDisplay } from '#lib/site/transitDisplayContext.ts';
	const { line } = transitDisplay();
	import { notReporting } from '#lib/components/map/vehicleProjection.ts';
	import { clock } from '@yesid/ui/state';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { Vehicle } from '#lib/v1/schemas/index.ts';
	import { absenceSentence, liveAbsenceReason, readLiveAbsenceContext } from '#lib/site/absence.ts';
	import { STATUS_LABELS } from '#lib/v1/enumLabels.ts';
	import type { MapSelectionDetailCopy } from '../mapSelectionDetail.copy';
	import { timeLabel } from '../mapSelectionDetail.logic';
	import { MaybeValue } from '#lib/components/edge/index.ts';
	import StatusBadge from '#lib/components/dataviz/StatusBadge.svelte';
	import { delayMeasurement } from '#lib/site/delayPresentation.ts';
	import '#lib/components/surface/compact-row.css';

	interface Props {
		vehicle: Vehicle;
		locale: Locale;
		timeZone?: string;
		etaUtc?: string | null;
		t: MapSelectionDetailCopy;
		onselect: (id: string) => void;
		onpreview?: (selection: { kind: 'vehicle'; id: string } | null) => void;
	}

	let { vehicle, locale, timeZone, etaUtc = null, t, onselect, onpreview }: Props = $props();
	const absenceContext = readLiveAbsenceContext();
	const absence = $derived(
		liveAbsenceReason('vehicle-delay', {
			...absenceContext(),
			notReporting: notReporting(vehicle, clock.serverNow, absenceContext().staleCutoffS) != null,
		}),
	);
	let pointerPreview = $state(false);
	let focusPreview = $state(false);
	const previewing = $derived(pointerPreview || focusPreview);

	function preview(pointer: boolean, focus: boolean): void {
		pointerPreview = pointer;
		focusPreview = focus;
		onpreview?.(pointer || focus ? { kind: 'vehicle', id: vehicle.id } : null);
	}
	const unknownStatusAndDelay = $derived(vehicle.status === 'unknown' && vehicle.delay_min == null);
	const accessibleName = $derived(
		!isInService(vehicle)
			? `${t.selectBus(vehicle.id)}, ${vehicleServiceCopy[locale].status}`
			: `${t.selectBus(vehicle.id)}, ${vehicle.route ? `${t.route} ${line(vehicle.route)}, ` : ''}${etaUtc ? `${timeLabel(etaUtc, locale, timeZone)}, ` : ''}${unknownStatusAndDelay ? '' : `${STATUS_LABELS[locale][vehicle.status]}, `}${t.delay}: ${delayMeasurement(vehicle.delay_min) ?? absenceSentence(absence, locale)}`,
	);
</script>

<Button
	variant="ghost"
	size="sm"
	type="button"
	class="detail-bus-row compact-row map-vehicle-action"
	data-previewing={previewing}
	aria-label={accessibleName}
	onclick={() => onselect(vehicle.id)}
	onpointerenter={() => preview(true, focusPreview)}
	onpointerleave={() => preview(false, focusPreview)}
	onfocus={() => preview(pointerPreview, true)}
	onblur={() => preview(pointerPreview, false)}
>
	<span class="detail-bus-head"
		><strong>{vehicle.id}</strong>
		<span>{vehicle.route ? `${t.route} ${line(vehicle.route)}` : t.bus}</span></span
	>
	<small>
		{#if !isInService(vehicle)}{vehicleServiceCopy[locale].status}{:else}
			<StatusBadge
				status={vehicle.status}
				label={STATUS_LABELS[locale][vehicle.status]}
				mode={unknownStatusAndDelay ? 'dot' : 'legend'}
				aria-hidden={unknownStatusAndDelay || undefined}
				size="sm"
			/>
			<MaybeValue
				value={delayMeasurement(vehicle.delay_min)}
				reason={absence}
				variant="compact"
				disclosure={false}
				{locale}
			/>
		{/if}</small
	>
	<ChevronRightIcon size={14} strokeWidth={2.25} aria-hidden="true" />
</Button>

<style>
	/* Identity and line on the first line, live status under it, as on the stop rows. */
	:global(.detail-bus-row) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		row-gap: 0.125rem;
		width: calc(100% + 1rem);
		height: auto;
		min-block-size: var(--size-tap-min);
		border: 0;
		background: transparent;
		font: inherit;
		text-align: left;
		white-space: normal;
		cursor: pointer;
	}
	:global(.detail-bus-row > .detail-bus-head),
	:global(.detail-bus-row > small) {
		grid-column: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	:global(.detail-bus-row .detail-bus-head) {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.625rem;
		font-size: var(--text-small);
	}
	:global(.detail-bus-row .detail-bus-head strong) {
		font-family: var(--font-mono);
		font-weight: 600;
	}
	:global(.detail-bus-row .detail-bus-head span) {
		color: var(--muted-foreground);
	}
	:global(.detail-bus-row small) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		color: var(--muted-foreground);
	}
	:global(.detail-bus-row > svg) {
		grid-column: 2;
		grid-row: 1 / span 2;
		color: var(--muted-foreground);
	}
	:global(.detail-bus-row:hover > svg),
	:global(.detail-bus-row[data-previewing='true'] > svg) {
		color: var(--primary);
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.detail-bus-row) {
			transition: none;
		}
	}
</style>
