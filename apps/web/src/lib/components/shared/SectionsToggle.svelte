<script lang="ts">
	import { SectionsToggle as UiSectionsToggle } from '@yesid/ui/brand';
	import { getLocale } from '#lib/i18n/index.ts';
	import { sectionsToggleCopy } from './sectionsToggle.copy';

	let { class: className = '' }: { class?: string } = $props();
</script>

<UiSectionsToggle copy={sectionsToggleCopy[getLocale()]} class={className} />
