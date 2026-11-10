<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { MapSelectionDetailCopy } from '../mapSelectionDetail.copy';
	import { stopDisplayName, timeLabel } from '../mapSelectionDetail.logic';
	import type { MapStopRef } from '../mapSelectionSession.svelte';
	import DetailEntityName from './DetailEntityName.svelte';
	import '#lib/components/surface/compact-row.css';

	interface Props {
		stop: MapStopRef;
		locale: Locale;
		timeZone?: string;
		t: MapSelectionDetailCopy;
		seqUnknownAria: string;
		onselect: (id: string) => void;
		onpreview?: (selection: { kind: 'stop'; id: string } | null) => void;
	}

	let { stop, locale, timeZone, t, seqUnknownAria, onselect, onpreview }: Props = $props();
	let pointerPreview = $state(false);
	let focusPreview = $state(false);
	const previewing = $derived(pointerPreview || focusPreview);

	function preview(pointer: boolean, focus: boolean): void {
		pointerPreview = pointer;
		focusPreview = focus;
		onpreview?.(pointer || focus ? { kind: 'stop', id: stop.id } : null);
	}
	const accessibleName = $derived(
		`${t.selectStop(stopDisplayName(stop, locale))}${stop.seq == null ? `, ${seqUnknownAria}` : `, ${stop.seq}`}${stop.etaUtc ? `, ${timeLabel(stop.etaUtc, locale, timeZone)}` : ''}`,
	);
</script>

<Button
	variant="ghost"
	size="sm"
	type="button"
	class="detail-stop-row compact-row map-stop-action"
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
	<span class="detail-stop-seq" aria-label={stop.seq == null ? seqUnknownAria : undefined}
		>{stop.seq ?? '–'}</span
	>
	<span class="detail-stop-name"><DetailEntityName ref={stop} {locale} /></span>
	{#if stop.etaUtc}<time class="detail-stop-time">{timeLabel(stop.etaUtc, locale, timeZone)}</time
		>{/if}
	<ChevronRightIcon size={14} strokeWidth={2.25} aria-hidden="true" />
</Button>

<style>
	/* Same rhythm as the line page's stop list: sequence, name, time, on one line. */
	:global(.detail-stop-row) {
		display: grid;
		grid-template-columns: 2ch minmax(0, 1fr) auto 1rem;
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
	:global(.detail-stop-row .detail-stop-seq) {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--muted-foreground);
	}
	:global(.detail-stop-row .detail-stop-name) {
		grid-column: 2;
		min-width: 0;
		font-size: var(--text-small);
		font-weight: 500;
		line-height: 1.35;
	}
	:global(.detail-stop-row .detail-stop-time) {
		grid-column: 3;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	:global(.detail-stop-row svg) {
		grid-column: 4;
		color: var(--muted-foreground);
	}
	:global(.detail-stop-row:hover svg),
	:global(.detail-stop-row[data-previewing='true'] svg) {
		color: var(--primary);
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.detail-stop-row) {
			transition: none;
		}
	}
</style>
