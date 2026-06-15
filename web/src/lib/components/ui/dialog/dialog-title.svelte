<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "$lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<DialogPrimitive.TitleProps> = $props();
</script>

<DialogPrimitive.Title
	bind:ref
	data-slot="dialog-title"
	class={cn("font-heading text-base leading-snug font-medium", className)}
	{...restProps}
>
	{@render children?.()}
</DialogPrimitive.Title>
