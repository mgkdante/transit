<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '../../cn/index.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<SheetPrimitive.DescriptionProps> = $props();
</script>

<SheetPrimitive.Description
	bind:ref
	data-slot="sheet-description"
	class={cn('text-muted-foreground text-small', className)}
	{...restProps}
>
	{@render children?.()}
</SheetPrimitive.Description>
