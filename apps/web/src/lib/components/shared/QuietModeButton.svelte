<script lang="ts">
	import { QuietModeButton as UiQuietModeButton } from '@yesid/ui/brand';
	import { getLocale } from '$lib/i18n';
	import { quietModeCopy } from './quietMode.copy';

	let { class: className = '' }: { class?: string } = $props();
</script>

<UiQuietModeButton copy={quietModeCopy[getLocale()]} class={className} />
