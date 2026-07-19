<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../../cn/index.js';

	export type SheetFooterProps = WithElementRef<
		HTMLAttributes<HTMLDivElement>,
		HTMLDivElement
	>;

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: SheetFooterProps = $props();
</script>

<div
	bind:this={ref}
	data-slot="sheet-footer"
	class={cn('mt-auto flex flex-col gap-2 p-4', className)}
	{...restProps}
>
	{@render children?.()}
</div>
