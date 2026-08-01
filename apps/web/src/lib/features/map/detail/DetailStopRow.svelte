<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '$lib/i18n';
	import type { MapSelectionDetailCopy } from '../mapSelectionDetail.copy';
	import { stopDisplayName, timeLabel } from '../mapSelectionDetail.logic';
	import type { MapStopRef } from '../mapSelection';
	import DetailEntityName from './DetailEntityName.svelte';

	interface Props {
		stop: MapStopRef;
		locale: Locale;
		t: MapSelectionDetailCopy;
		seqUnknownAria: string;
		onselect: (id: string) => void;
	}

	let { stop, locale, t, seqUnknownAria, onselect }: Props = $props();
	const accessibleName = $derived(
		`${t.selectStop(stopDisplayName(stop, locale))}${stop.seq == null ? `, ${seqUnknownAria}` : `, ${stop.seq}`}${stop.etaUtc ? `, ${timeLabel(stop.etaUtc, locale)}` : ''}`,
	);
</script>

<button
	type="button"
	class="detail-stop-row map-stop-action"
	data-detail-stop-id={stop.id}
	data-detail-focus-key={`stop:${stop.id}`}
	aria-label={accessibleName}
	onclick={() => onselect(stop.id)}
>
	<span aria-label={stop.seq == null ? seqUnknownAria : undefined}>{stop.seq ?? ''}</span>
	<strong><DetailEntityName ref={stop} {locale} /></strong>
	{#if stop.etaUtc}<small><time>{timeLabel(stop.etaUtc, locale)}</time></small>{/if}
	<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
</button>

<style>
	.detail-stop-row {
		display: grid;
		grid-template-columns: 1.9rem minmax(0, 1fr) auto;
		gap: 0.625rem;
		width: 100%;
		align-items: center;
		padding: 0.5rem;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		background: transparent;
		text-align: left;
		color: var(--foreground);
	}
	.detail-stop-row strong {
		min-width: 0;
	}
	.detail-stop-row small {
		grid-column: 2;
		font-family: var(--font-mono);
	}
</style>
