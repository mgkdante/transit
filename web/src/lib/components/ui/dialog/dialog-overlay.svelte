<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.OverlayProps> = $props();
</script>

<!--
	The overlay is a curtain, not a surface, so a translucent ink wash is correct
	here (surfaces stay solid — no alpha on card/popover bg): it dims the page
	beneath without bleeding the brand grid through a panel. Stacks under content
	via --z-index-menu. Raw token values go inline per the styling convention so
	the runtime-applied class isn't flagged as an unused scoped selector.
-->
<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	style="z-index: var(--z-index-menu); background: var(--scrim, color-mix(in srgb, var(--background) 70%, transparent));"
	class={cn(
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0",
		className
	)}
	{...restProps}
/>
