<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card-title"
	class={cn(
		"font-heading text-body leading-snug font-medium group-data-[size=sm]/card:text-small",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
