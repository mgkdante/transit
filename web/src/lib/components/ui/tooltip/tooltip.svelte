<script lang="ts">
	import { Tooltip as TooltipPrimitive } from 'bits-ui';

	let {
		delayDuration = 0,
		disableHoverableContent,
		disableCloseOnTriggerClick,
		disabled,
		ignoreNonKeyboardFocus,
		...restProps
	}: TooltipPrimitive.RootProps & {
		delayDuration?: number;
		disableHoverableContent?: boolean;
		disableCloseOnTriggerClick?: boolean;
		disabled?: boolean;
		ignoreNonKeyboardFocus?: boolean;
	} = $props();
</script>

<!--
bits-ui v2 splits the provider (timing config) from the root (open state).
We co-locate a single-instance Provider with the Root so consumers can use
`<Tooltip.Root>` directly without a top-level provider boilerplate.
-->
<TooltipPrimitive.Provider
	{delayDuration}
	{disableHoverableContent}
	{disableCloseOnTriggerClick}
	{disabled}
	{ignoreNonKeyboardFocus}
>
	<TooltipPrimitive.Root {...restProps} />
</TooltipPrimitive.Provider>
