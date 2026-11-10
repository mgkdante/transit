<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FunnelPlusIcon from '@lucide/svelte/icons/funnel-plus';

	interface Props {
		/** `filter` narrows the map to this value; `open` selects the named entity. */
		kind: 'filter' | 'open';
		label: string;
		onclick: () => void;
	}

	let { kind, label, onclick }: Props = $props();
</script>

<!-- The trailing action of a fact row. Always the third column, so values stay aligned. -->
<dd class="detail-attribute-action">
	<Button
		variant="ghost"
		size="icon-tap"
		type="button"
		class="detail-fact-action"
		data-action={kind}
		aria-label={label}
		title={label}
		{onclick}
	>
		{#if kind === 'filter'}
			<FunnelPlusIcon size={15} strokeWidth={2.25} aria-hidden="true" />
		{:else}
			<ChevronRightIcon size={16} strokeWidth={2.25} aria-hidden="true" />
		{/if}
	</Button>
</dd>
