<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.TriggerProps = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn(
		// Layout + base typography (shared by both variants).
		'relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-1.5 py-0.5 text-small font-medium text-foreground/60 transition-all hover:text-foreground group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start disabled:pointer-events-none disabled:opacity-50',
		// Icon sizing + non-interactivity.
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1",
		// Focus ring — brand ring, visible.
		'outline-none focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
		// default variant: active trigger lifts onto the background surface.
		'group-data-[variant=default]/tabs-list:data-[state=active]:bg-background group-data-[variant=default]/tabs-list:data-[state=active]:text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-card',
		// line variant: stay transparent; underline rule carries the active state.
		'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground',
		// Active underline (line variant only). --primary is interactive-only;
		// the active-tab marker is an interactive affordance, not a data mark.
		'after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100',
		className,
	)}
	{...restProps}
/>
