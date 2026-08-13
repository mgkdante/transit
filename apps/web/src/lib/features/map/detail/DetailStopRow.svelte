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
		onpreview?: (selection: { kind: 'stop'; id: string } | null) => void;
	}

	let { stop, locale, t, seqUnknownAria, onselect, onpreview }: Props = $props();
	let pointerPreview = $state(false);
	let focusPreview = $state(false);
	const previewing = $derived(pointerPreview || focusPreview);

	function preview(pointer: boolean, focus: boolean): void {
		pointerPreview = pointer;
		focusPreview = focus;
		onpreview?.(previewing ? { kind: 'stop', id: stop.id } : null);
	}
	const accessibleName = $derived(
		`${t.selectStop(stopDisplayName(stop, locale))}${stop.seq == null ? `, ${seqUnknownAria}` : `, ${stop.seq}`}${stop.etaUtc ? `, ${timeLabel(stop.etaUtc, locale)}` : ''}`,
	);
</script>

<button
	type="button"
	class="detail-stop-row map-stop-action"
	data-detail-stop-id={stop.id}
	data-detail-focus-key={`stop:${stop.id}`}
	data-previewing={previewing}
	aria-label={accessibleName}
	onclick={() => onselect(stop.id)}
	onpointerenter={() => preview(true, focusPreview)}
	onpointerleave={() => preview(false, focusPreview)}
	onfocus={() => preview(pointerPreview, true)}
	onblur={() => preview(pointerPreview, false)}
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
	.detail-stop-row:hover,
	.detail-stop-row[data-previewing='true'] {
		border-bottom-color: var(--border);
		background: var(--muted);
	}
	.detail-stop-row:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.detail-stop-row :global(svg) {
		grid-column: 3;
		grid-row: 1 / span 2;
	}
	.detail-stop-row strong {
		min-width: 0;
	}
	.detail-stop-row small {
		grid-column: 2;
		font-family: var(--font-mono);
	}
	@media (prefers-reduced-motion: reduce) {
		.detail-stop-row {
			transition-duration: 0.01ms;
		}
	}
</style>
