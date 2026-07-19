<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../../cn/index.js';

	export type SheetHeaderProps = WithElementRef<
		HTMLAttributes<HTMLDivElement>,
		HTMLDivElement
	>;

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: SheetHeaderProps = $props();
</script>

<div
	bind:this={ref}
	data-slot="sheet-header"
	class={cn('flex flex-col gap-1.5 p-4', className)}
	{...restProps}
>
	{@render children?.()}
</div>
