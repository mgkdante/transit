<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "$lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		orientation = "vertical",
		children,
		...restProps
	}: WithoutChild<ScrollAreaPrimitive.ScrollbarProps> = $props();
</script>

<ScrollAreaPrimitive.Scrollbar
	bind:ref
	data-slot="scroll-area-scrollbar"
	data-orientation={orientation}
	{orientation}
	class={cn(
		"flex touch-none select-none p-px transition-colors data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
		className,
	)}
	{...restProps}
>
	{@render children?.()}
	<!-- Brand thumb. The scrollbar is interactive chrome, not a data mark, so
	     --primary is doctrine-compliant here. -->
	<ScrollAreaPrimitive.Thumb
		data-slot="scroll-area-thumb"
		class="relative flex-1 rounded-full bg-primary/35"
	/>
</ScrollAreaPrimitive.Scrollbar>
