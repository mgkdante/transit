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
		<MapSelectionDetail
			detail={selectedDetail}
			{locale}
			{notReporting}
			{selectionPresence}
			{selectionSourceHealth}
			{onrefresh}
			{onselect}
			{onfilter}
			{onalertselect}
			presentation="body"
		/>
	{/if}
</BottomSheet>
