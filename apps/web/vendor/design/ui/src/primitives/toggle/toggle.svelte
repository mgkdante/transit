<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';
	import { twMergeConfig } from '../../cn/index.js';

	// Pressed-state uses --primary because a toggle's "on" is an INTERACTIVE
	// affordance (the control's own state), not a data mark — doctrine permits
	// --primary for interactivity. Never use this primitive to encode DATA.
	export const toggleVariants = tv(
		{
			base: "hover:text-foreground hover:bg-muted aria-pressed:bg-primary/15 aria-pressed:text-primary aria-pressed:border-primary/30 data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:border-primary/30 focus-visible:border-ring focus-visible:ring-ring/50 group/toggle inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full font-mono text-small font-medium text-muted-foreground outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
			variants: {
				variant: {
					default: 'bg-transparent',
					outline: 'border border-border-subtle bg-transparent hover:bg-muted',
				},
				size: {
					default:
						'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
					sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-caption has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
					lg: 'h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
				},
			},
			defaultVariants: {
				variant: 'default',
				size: 'default',
			},
		},
		{ twMergeConfig },
	);

	export type ToggleVariant = VariantProps<typeof toggleVariants>['variant'];
	export type ToggleSize = VariantProps<typeof toggleVariants>['size'];
	export type ToggleVariants = VariantProps<typeof toggleVariants>;
</script>

<script lang="ts">
	import { Toggle as TogglePrimitive } from 'bits-ui';
	import { cn } from '../../cn/index.js';

	let {
		ref = $bindable(null),
		pressed = $bindable(false),
		class: className,
		size = 'default',
		variant = 'default',
		...restProps
	}: TogglePrimitive.RootProps & {
		variant?: ToggleVariant;
		size?: ToggleSize;
	} = $props();
</script>

<TogglePrimitive.Root
	bind:ref
	bind:pressed
	data-slot="toggle"
	class={cn(toggleVariants({ variant, size }), className)}
	{...restProps}
/>
