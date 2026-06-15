<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<SheetPrimitive.OverlayProps> = $props();
</script>

<!--
	Sheet scrim — a translucent ink curtain that dims the page behind the drawer.
	A curtain, not a surface, so alpha is allowed here (surfaces stay solid).
	Anchored to --z-index-sheet, one rung below the content. Raw token values go
	inline per the styling convention so the runtime-applied class isn't flagged
	as an unused scoped selector.
-->
<SheetPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	style="z-index: var(--z-index-sheet); background: var(--scrim, color-mix(in srgb, var(--background) 70%, transparent));"
	class={cn(
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0",
		className
	)}
	{...restProps}
/>
