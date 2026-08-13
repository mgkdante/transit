<!--
  MapMobileDetailSheet — the mobile detail BottomSheet, sibling of the desktop overlay.

  SINGLE RESPONSIBILITY: render the selected detail in a bottom sheet on mobile (the
  desktop detail lives in the right overlay). Deliberately a SEPARATE sibling so the
  desktop overlay vs mobile sheet split stays explicit. Owns no state: the `{#if
  detailOpen && !layout.isDesktop}` gate stays in MapHero; this is the BODY. No CSS.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import type { Chip } from '$lib/filters';
	import type { Alert } from '$lib/v1/schemas';
	import { BottomSheet } from '$lib/components/shell';
	import type { MapSelection, MapSelectionDetail as MapSelectionDetailModel } from './mapSelection';
	import type { SelectionPresence, SelectionSourceHealth } from './selectionGrace.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';
	import { detailActions, detailIdentity } from './mapSelectionDetail.logic';

	interface Props {
		open: boolean;
		locale: Locale;
		title?: string;
		surfaceKey: string;
		canGoBack: boolean;
		onback: () => void;
		selectedDetail: MapSelectionDetailModel | null;
		notReporting: { ageS: number } | null;
		selectionPresence?: SelectionPresence | null;
		selectionSourceHealth?: SelectionSourceHealth | null;
		onrefresh?: () => void;
		onselect: (selection: MapSelection) => void;
		onpreview?: (selection: MapSelection | null) => void;
		onfilter: (chip: Chip) => void;
		onalertselect: (alert: Alert) => void;
		identity?: Snippet;
		footer?: Snippet;
	}

	let {
		open = $bindable(),
		locale,
		title,
		surfaceKey,
		canGoBack,
		onback,
		selectedDetail,
		notReporting,
		selectionPresence = null,
		selectionSourceHealth = null,
		onrefresh,
		onselect,
		onpreview,
		onfilter,
		onalertselect,
		identity,
		footer,
	}: Props = $props();

	const sheetTitle = $derived(selectedDetail ? detailIdentity(selectedDetail, locale) : title);
	const hasAction = $derived(
		selectedDetail ? detailActions(selectedDetail, locale) != null : false,
	);
</script>

{#snippet resolvedIdentity()}
	{#if selectedDetail}
		<MapSelectionDetail detail={selectedDetail} {locale} presentation="identity" />
	{/if}
{/snippet}

{#snippet resolvedFooter()}
	{#if selectedDetail}
		<MapSelectionDetail detail={selectedDetail} {locale} presentation="action" />
	{/if}
{/snippet}

<BottomSheet
	bind:open
	{locale}
	title={sheetTitle}
	identity={identity ?? (selectedDetail ? resolvedIdentity : undefined)}
	footer={footer ?? (hasAction ? resolvedFooter : undefined)}
	{surfaceKey}
	{canGoBack}
	{onback}
>
	{#if selectedDetail}
		<div class="mobile-detail-body" data-mobile-detail-body>
			<MapSelectionDetail
				detail={selectedDetail}
				{locale}
				{notReporting}
				{selectionPresence}
				{selectionSourceHealth}
				{onrefresh}
				{onselect}
				{onpreview}
				{onfilter}
				{onalertselect}
				presentation="body"
			/>
		</div>
	{/if}
</BottomSheet>

<style>
	.mobile-detail-body :global(.detail-attribute-grid > div) {
		grid-template-columns: 5.75rem minmax(0, 1fr) minmax(5.5rem, auto);
		align-items: center;
		column-gap: 0.75rem;
		padding-block: 0.75rem;
		border-bottom-width: 1px;
		border-bottom-style: solid;
		border-bottom-color: var(--border);
	}
	.mobile-detail-body :global(.detail-attribute-grid > div > dt) {
		grid-column: 1;
	}
	.mobile-detail-body :global(.detail-attribute-grid > div > dd) {
		grid-column: 2;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.mobile-detail-body :global(.detail-attribute-grid > div > .detail-fact-action) {
		grid-column: 3;
		min-width: 5.5rem;
		min-block-size: 2.75rem;
		justify-content: center;
	}
	.mobile-detail-body :global(.detail-attribute-grid > div > dd .detail-fact-action) {
		max-width: 100%;
		white-space: normal;
		overflow-wrap: anywhere;
	}
</style>
