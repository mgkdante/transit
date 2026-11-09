<script lang="ts">
	import { stopDisplayName } from '#lib/site/transitDisplay.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import { stopNameFallback } from '#lib/site/absence.ts';
	import type { MapStopRef } from '../mapSelectionSession.svelte';

	interface Props {
		ref: MapStopRef;
		locale: Locale;
	}

	let { ref, locale }: Props = $props();
</script>

<span class="detail-entity-name"
	>{ref.nameAbsent ? stopNameFallback(ref.id, locale) : stopDisplayName(ref.name)}</span
>

<style>
	.detail-entity-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
