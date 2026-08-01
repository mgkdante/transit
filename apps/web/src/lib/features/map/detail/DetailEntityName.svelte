<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { stopNameFallback } from '$lib/site/absence';
	import type { MapStopRef } from '../mapSelection';

	interface Props {
		ref: MapStopRef;
		locale: Locale;
	}

	let { ref, locale }: Props = $props();
</script>

<span class="detail-entity-name"
	>{ref.nameAbsent ? stopNameFallback(ref.id, locale) : ref.name}</span
>

<style>
	.detail-entity-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
