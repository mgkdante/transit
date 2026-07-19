<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '../../cn/index.js';

	export type SheetTitleProps = WithoutChild<SheetPrimitive.TitleProps>;

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: SheetTitleProps = $props();
</script>

<SheetPrimitive.Title
	bind:ref
	data-slot="sheet-title"
	class={cn('font-heading text-base leading-snug font-medium', className)}
	{...restProps}
>
	{@render children?.()}
</SheetPrimitive.Title>
