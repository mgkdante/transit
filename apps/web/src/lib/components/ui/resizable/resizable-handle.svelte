<script lang="ts">
	import * as ResizablePrimitive from 'paneforge';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		withHandle = false,
		...restProps
	}: WithoutChildrenOrChild<ResizablePrimitive.PaneResizerProps> & {
		withHandle?: boolean;
	} = $props();
</script>

<!-- The resize handle is interactive chrome, not a data mark, so --primary
     (orange) is doctrine-compliant for the hover/focus affordance. The rail and
     grip rest on --border; dragging/focus brings up the orange voice. -->
<ResizablePrimitive.PaneResizer
	bind:ref
	data-slot="resizable-handle"
	class={cn(
		'relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-1 after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 data-[active=pointer]:bg-primary data-[direction=vertical]:h-px data-[direction=vertical]:w-full data-[direction=vertical]:after:left-0 data-[direction=vertical]:after:h-1 data-[direction=vertical]:after:w-full data-[direction=vertical]:after:translate-x-0 data-[direction=vertical]:after:-translate-y-1/2 [&[data-direction=vertical]>div]:rotate-90',
		className,
	)}
	{...restProps}
>
	{#if withHandle}
		<div class="z-10 flex h-6 w-1 shrink-0 rounded-sm bg-border"></div>
	{/if}
</ResizablePrimitive.PaneResizer>
