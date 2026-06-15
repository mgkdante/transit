<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";
	import { twMergeConfig } from "$lib/utils";

	// `default` = solid pill rail on a card surface (segmented control).
	// `line`    = transparent rail; the active trigger draws an underline rule.
	export const tabsListVariants = tv(
		{
			base: "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
			variants: {
				variant: {
					default: "bg-card shadow-card",
					line: "gap-1 bg-transparent p-0",
				},
			},
			defaultVariants: {
				variant: "default",
			},
		},
		{ twMergeConfig },
	);

	export type TabsListVariant = VariantProps<typeof tabsListVariants>["variant"];
</script>

<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils";

	let {
		ref = $bindable(null),
		variant = "default",
		class: className,
		...restProps
	}: TabsPrimitive.ListProps & {
		variant?: TabsListVariant;
	} = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	data-variant={variant}
	class={cn(tabsListVariants({ variant }), className)}
	{...restProps}
/>
