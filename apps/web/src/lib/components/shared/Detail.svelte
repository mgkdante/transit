<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { ChevronToggle } from '@yesid/ui/brand';
	import * as Collapsible from '@yesid/ui/collapsible';

	let {
		label,
		labelOpen = undefined,
		open = $bindable(false),
		class: className,
		children,
	}: {
		label: string;
		labelOpen?: string;
		open?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});

	let hasOpened = $state(false);
	$effect(() => {
		if (open) hasOpened = true;
	});

	const currentLabel = $derived(open ? (labelOpen ?? label) : label);
</script>

<Collapsible.Root bind:open class={cn('detail', className)} data-slot="detail">
	<Collapsible.Trigger
		class="inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0.5 py-1.5 font-mono text-small font-medium text-muted-foreground transition-colors duration-fast ease-default disabled:cursor-default disabled:opacity-50 hover:text-primary-hover hover:underline hover:underline-offset-[3px] focus-visible:rounded-sm focus-visible:text-primary-hover focus-visible:underline focus-visible:underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring motion-reduce:transition-none"
		data-slot="detail-toggle"
		disabled={!ready}
	>
		<ChevronToggle {open} direction="down" size="sm" />
		<span>{currentLabel}</span>
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div class="flex flex-col gap-[clamp(1.75rem,4vw,2.75rem)] pt-6" data-slot="detail-body">
			{#if open || hasOpened}{@render children?.()}{/if}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
