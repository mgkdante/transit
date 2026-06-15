<script lang="ts">
	import type { WithElementRef } from "$lib/utils";
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "$lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!--
Loading placeholder. Surface = bg-muted (solid, no alpha — surfaces stay
opaque per doctrine). Pulse animation from tw-animate-css; the scoped
reduced-motion guard below halts it for users who opt out.
-->
<div
	bind:this={ref}
	data-slot="skeleton"
	aria-hidden="true"
	class={cn("skeleton-pulse rounded-md bg-muted", className)}
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	.skeleton-pulse {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-pulse {
			animation: none;
		}
	}
</style>
