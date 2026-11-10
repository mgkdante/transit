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
	class="detail-bus-row map-vehicle-action"
	data-previewing={previewing}
	aria-label={accessibleName}
	onclick={() => onselect(vehicle.id)}
	onpointerenter={() => preview(true, focusPreview)}
	onpointerleave={() => preview(false, focusPreview)}
	onfocus={() => preview(pointerPreview, true)}
	onblur={() => preview(pointerPreview, false)}
>
	<strong>{vehicle.id}</strong>
	<span>{vehicle.route ? `${t.route} ${line(vehicle.route)}` : t.bus}</span>
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
	<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
</Button>

<style>
	:global(.detail-bus-row) {
		height: auto;
		white-space: normal;
	}
	:global(.detail-bus-row) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.5rem;
		width: 100%;
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		align-items: center;
		padding: calc(var(--spacing) * 2) 0;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		background: transparent;
		text-align: left;
		color: var(--foreground);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}
	:global(.detail-bus-row:hover),
	:global(.detail-bus-row[data-previewing='true']) {
		border-bottom-color: var(--border);
		background-color: var(--muted);
	}
	:global(.detail-bus-row:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -1px;
	}
	:global(.detail-bus-row > strong),
	:global(.detail-bus-row > span),
	:global(.detail-bus-row > small) {
		grid-column: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	:global(.detail-bus-row strong) {
		font-family: var(--font-mono);
	}
	:global(.detail-bus-row small) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		color: var(--muted-foreground);
	}
	:global(.detail-bus-row svg) {
		grid-column: 2;
		grid-row: 1 / span 3;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.detail-bus-row) {
			transition: none;
		}
	}
</style>
