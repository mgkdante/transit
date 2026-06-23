<!--
  MapMobileDetailSheet — the mobile detail BottomSheet, sibling of the desktop overlay.

  SINGLE RESPONSIBILITY: render the selected detail in a bottom sheet on mobile (the
  desktop detail lives in the right overlay). Deliberately a SEPARATE sibling so the
  desktop overlay vs mobile sheet split stays explicit. Owns no state: the `{#if
  detailOpen && !layout.isDesktop}` gate stays in MapHero; this is the BODY. No CSS.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { Chip } from '$lib/filters';
	import type { Alert } from '$lib/v1/schemas';
	import { BottomSheet } from '$lib/components/shell';
	import type { MapSelection, MapSelectionDetail as MapSelectionDetailModel } from './mapSelection';
	import MapSelectionDetail from './MapSelectionDetail.svelte';

	interface Props {
		open: boolean;
		locale: Locale;
		title: string | undefined;
		surfaceKey: string;
		canGoBack: boolean;
		onback: () => void;
		selectedDetail: MapSelectionDetailModel | null;
		notReporting: { ageS: number } | null;
		onselect: (selection: MapSelection) => void;
		onfilter: (chip: Chip) => void;
		onalertselect: (alert: Alert) => void;
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
		onselect,
		onfilter,
		onalertselect,
	}: Props = $props();
</script>

<BottomSheet bind:open {locale} {title} {surfaceKey} {canGoBack} {onback}>
	{#if selectedDetail}
		<MapSelectionDetail
			detail={selectedDetail}
			{locale}
			{notReporting}
			{onselect}
			{onfilter}
			{onalertselect}
		/>
	{/if}
</BottomSheet>
