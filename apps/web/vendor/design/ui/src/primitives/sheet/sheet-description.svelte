<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '../../cn/index.js';

	export type SheetDescriptionProps = WithoutChild<SheetPrimitive.DescriptionProps>;

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: SheetDescriptionProps = $props();
</script>

<SheetPrimitive.Description
	bind:ref
	data-slot="sheet-description"
	class={cn('text-muted-foreground text-small', className)}
	{...restProps}
>
	{@render children?.()}
</SheetPrimitive.Description>
