<script lang="ts">
	import type { Locale } from '#lib/i18n/index.ts';
	import type { Snippet } from 'svelte';
	import type { Chip } from '#lib/filters/index.ts';
	import type { Alert } from '#lib/v1/schemas/index.ts';
	import { BottomSheet } from '#lib/components/shell/index.ts';
	import type {
		MapSelection,
		MapSelectionDetail as MapSelectionDetailModel,
	} from './mapSelectionSession.svelte';
	import type { SelectionPresence, SelectionSourceHealth } from './mapSelectionSession.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';
	import { detailActions, detailIdentity } from './mapSelectionDetail.logic';

	interface Props {
		open: boolean;
		locale: Locale;
		timeZone?: string;
		title?: string;
		surfaceKey: string;
		canGoBack: boolean;
		onback: () => void;
		selectedDetail: MapSelectionDetailModel | null;
		alertsStale?: boolean;
		alertsAgeSeconds?: number | null;
		notReporting: { ageS: number } | null;
		selectionPresence?: SelectionPresence | null;
		selectionSourceHealth?: SelectionSourceHealth | null;
		onrefresh?: () => void;
		onselect: (selection: MapSelection) => void;
		onpreview?: (selection: MapSelection | null) => void;
		onfilter: (chip: Chip) => void;
		onalertselect: (alert: Alert) => void;
		identity?: Snippet;
		navigation?: Snippet;
		footer?: Snippet;
	}

	let {
		open = $bindable(),
		locale,
		timeZone,
		title,
		surfaceKey,
		canGoBack,
		onback,
		selectedDetail,
		alertsStale = false,
		alertsAgeSeconds = null,
		notReporting,
		selectionPresence = null,
		selectionSourceHealth = null,
		onrefresh,
		onselect,
		onpreview,
		onfilter,
		onalertselect,
		identity,
		navigation,
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
	class="map-mobile-detail-sheet"
	bind:open
	{locale}
	title={sheetTitle}
	identity={identity ?? (selectedDetail ? resolvedIdentity : undefined)}
	footer={footer ?? (hasAction ? resolvedFooter : undefined)}
	{navigation}
	{surfaceKey}
	{canGoBack}
	{onback}
>
	{#if selectedDetail}
		<div class="mobile-detail-body" data-mobile-detail-body>
			<MapSelectionDetail
				{alertsStale}
				{alertsAgeSeconds}
				detail={selectedDetail}
				{locale}
				{timeZone}
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
	:global(.map-mobile-detail-sheet) {
		max-height: 50svh;
	}
</style>
