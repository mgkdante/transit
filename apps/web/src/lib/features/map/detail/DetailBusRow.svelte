<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '$lib/i18n';
	import type { Vehicle } from '$lib/v1/schemas';
	import { absenceSentence } from '$lib/site/absence';
	import { STATUS_LABELS } from '$lib/v1/enumLabels';
	import type { MapSelectionDetailCopy } from '../mapSelectionDetail.copy';
	import { timeLabel } from '../mapSelectionDetail.logic';
	import { MaybeValue } from '$lib/components/edge';
	import StatusBadge from '$lib/components/dataviz/StatusBadge.svelte';
	import { delayMeasurement } from '$lib/site/delayPresentation';

	interface Props {
		vehicle: Vehicle;
		locale: Locale;
		etaUtc?: string | null;
		t: MapSelectionDetailCopy;
		onselect: (id: string) => void;
		onpreview?: (selection: { kind: 'vehicle'; id: string } | null) => void;
	}

	let { vehicle, locale, etaUtc = null, t, onselect, onpreview }: Props = $props();
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
		`${t.selectBus(vehicle.id)}, ${vehicle.route ? `${t.route} ${vehicle.route}, ` : ''}${etaUtc ? `${timeLabel(etaUtc, locale)}, ` : ''}${unknownStatusAndDelay ? '' : `${STATUS_LABELS[locale][vehicle.status]}, `}${t.delay}: ${delayMeasurement(vehicle.delay_min) ?? absenceSentence('not-reported', locale)}`,
	);
</script>

<button
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
	<span>{vehicle.route ? `${t.route} ${vehicle.route}` : t.bus}</span>
	<small>
		<StatusBadge
			status={vehicle.status}
			label={STATUS_LABELS[locale][vehicle.status]}
			mode={unknownStatusAndDelay ? 'dot' : 'legend'}
			aria-hidden={unknownStatusAndDelay || undefined}
			size="sm"
		/>
		<MaybeValue
			value={delayMeasurement(vehicle.delay_min)}
			reason="not-reported"
			variant={unknownStatusAndDelay ? 'row' : 'inline'}
			{locale}
		/>
	</small>
	<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
</button>

<style>
	.detail-bus-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.5rem;
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
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}
	.detail-bus-row:hover,
	.detail-bus-row[data-previewing='true'] {
		border-bottom-color: var(--border);
		background-color: var(--muted);
	}
	.detail-bus-row:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -1px;
	}
	.detail-bus-row > strong,
	.detail-bus-row > span,
	.detail-bus-row > small {
		grid-column: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.detail-bus-row strong {
		font-family: var(--font-mono);
	}
	.detail-bus-row small {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		color: var(--muted-foreground);
	}
	.detail-bus-row :global(svg) {
		grid-column: 2;
		grid-row: 1 / span 3;
	}
	@media (prefers-reduced-motion: reduce) {
		.detail-bus-row {
			transition: none;
		}
	}
</style>
