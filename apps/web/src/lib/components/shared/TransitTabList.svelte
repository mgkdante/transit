<script lang="ts" generics="K extends string">
	import { TabsList, TabsTrigger } from '@yesid/ui/tabs';
	let {
		tabs,
		compact = false,
		label,
		onselect,
	}: {
		tabs: readonly { key: K; label: string }[];
		compact?: boolean;
		label?: string;
		onselect?: (key: K) => void;
	} = $props();
</script>

<TabsList
	variant="line"
	class="station-tabs transit-tab-list w-full min-w-0 max-w-full flex-nowrap justify-start"
	aria-label={label}
>
	{#each tabs as tab (tab.key)}
		<TabsTrigger value={tab.key} onclick={() => onselect?.(tab.key)}>
			{#snippet child({ props })}<button
					{...props}
					class="station-tab"
					class:transit-tab-compact={compact}>{tab.label}</button
				>{/snippet}
		</TabsTrigger>
	{/each}
</TabsList>

<style>
	/* A tab row never widens its page: extra tabs scroll within the row. */
	:global(.transit-tab-list) {
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: thin;
	}
	.transit-tab-compact {
		flex: none;
		padding-inline: calc(var(--spacing) * 3);
		font-size: var(--text-caption);
	}
</style>
