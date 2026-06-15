<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";
	import { twMergeConfig } from "$lib/utils";

	// Alert is a SURFACE (solid bg-card), not an interactive affordance, so its
	// accent must NEVER borrow --primary/--destructive/--accent. Data severity is
	// encoded with the dataviz severity scale only. Doctrine: status is glyph +
	// colour, never colour alone — callers pair a severity variant with the
	// matching glyph icon (▲ high / ◆ critical / ○ watch via lucide).
	//
	// tv() runs its own tailwind-merge before cn(); feed it the @theme vocabulary
	// so the dataviz color names aren't misread as font-sizes and dropped.
	export const alertVariants = tv(
		{
			base: "alert-surface text-card-foreground relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-small has-[>svg]:grid-cols-[calc(var(--spacing)*5)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5",
			variants: {
				variant: {
					// Neutral, no data severity — quiet card surface.
					default: "alert-neutral [&>svg]:text-muted-foreground",
					critical: "alert-critical [&>svg]:text-dataviz-severity-critical",
					high: "alert-high [&>svg]:text-dataviz-severity-high",
					watch: "alert-watch [&>svg]:text-dataviz-severity-watch",
				},
			},
			defaultVariants: {
				variant: "default",
			},
		},
		{ twMergeConfig }
	);

	export type AlertVariant = VariantProps<typeof alertVariants>["variant"];
</script>

<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils";

	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: AlertVariant;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert"
	data-variant={variant}
	role="alert"
	class={cn(alertVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	/* Solid surface (doctrine: no alpha on card backgrounds). Severity is carried
	   by a 3px left rule in the dataviz severity hue + a tinted border — data
	   marks only, never interactive --primary. */
	.alert-surface {
		background: var(--card);
		border-color: var(--border);
		border-left-width: 3px;
	}
	.alert-neutral {
		border-left-color: var(--border-strong, var(--border));
	}
	.alert-critical {
		border-left-color: var(--dataviz-severity-critical);
		border-color: color-mix(in srgb, var(--dataviz-severity-critical) 40%, var(--border));
	}
	.alert-high {
		border-left-color: var(--dataviz-severity-high);
		border-color: color-mix(in srgb, var(--dataviz-severity-high) 40%, var(--border));
	}
	.alert-watch {
		border-left-color: var(--dataviz-severity-watch);
		border-color: color-mix(in srgb, var(--dataviz-severity-watch) 40%, var(--border));
	}
</style>
