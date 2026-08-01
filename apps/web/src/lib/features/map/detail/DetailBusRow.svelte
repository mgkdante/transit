<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '$lib/i18n';
	import type { Vehicle } from '$lib/v1/schemas';
	import { STATUS_LABELS } from '$lib/v1/enumLabels';
	import type { MapSelectionDetailCopy } from '../mapSelectionDetail.copy';
	import { delayKnownLabel, timeLabel } from '../mapSelectionDetail.logic';
	import MapDelayTag from '../MapDelayTag.svelte';

	interface Props {
		vehicle: Vehicle;
		locale: Locale;
		etaUtc?: string | null;
		t: MapSelectionDetailCopy;
		onselect: (id: string) => void;
	}

	let { vehicle, locale, etaUtc = null, t, onselect }: Props = $props();
	const accessibleName = $derived(
		`${t.selectBus(vehicle.id)}, ${vehicle.route ? `${t.route} ${vehicle.route}, ` : ''}${etaUtc ? `${timeLabel(etaUtc, locale)}, ` : ''}${STATUS_LABELS[locale][vehicle.status]}, ${t.delay}: ${vehicle.delay_min == null ? t.noData : delayKnownLabel(vehicle.delay_min, t)}`,
	);
</script>

<button
	type="button"
	class="detail-bus-row map-vehicle-action"
	aria-label={accessibleName}
	onclick={() => onselect(vehicle.id)}
>
	<strong>{vehicle.id}</strong>
	<span>{vehicle.route ? `${t.route} ${vehicle.route}` : t.bus}</span>
	<small
		><span>{STATUS_LABELS[locale][vehicle.status]}</span><MapDelayTag
			delay={vehicle.delay_min}
			{locale}
			{t}
		/></small
	>
	<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
</button>

<style>
	.detail-bus-row {
		display: grid;
		grid-template-columns: minmax(3.5rem, auto) minmax(0, 1fr) auto auto;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		align-items: center;
		padding: 0.5rem;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		background: transparent;
		text-align: left;
		color: var(--foreground);
	}
	.detail-bus-row strong {
		font-family: var(--font-mono);
	}
	.detail-bus-row small {
		color: var(--muted-foreground);
	}
</style>
