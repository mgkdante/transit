<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';
	import { twMergeConfig } from '../../cn/index.js';

	export const sheetVariants = tv(
		{
			base: 'bg-popover text-popover-foreground shadow-sheet fixed flex flex-col gap-4 transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out',
			variants: {
				side: {
					left: 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 max-w-sm border-r border-border',
					right:
						'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 max-w-sm border-l border-border',
					bottom:
						'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 max-h-[90svh] w-full rounded-t-xl border-t border-border',
				},
			},
			defaultVariants: {
				// Bottom drawer is the mobile-first default.
				side: 'bottom',
			},
		},
		{ twMergeConfig },
	);

	export type SheetSide = VariantProps<typeof sheetVariants>['side'];
</script>

<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import SheetOverlay from './sheet-overlay.svelte';
	import {
		cn,
		type WithoutChildren,
		type WithoutChildrenOrChild,
	} from '../../cn/index.js';

	export type SheetContentProps = WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
		side?: SheetSide;
		portalProps?: WithoutChildren<SheetPrimitive.PortalProps>;
		showCloseButton?: boolean;
		closeLabel?: string;
		children: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		side = 'bottom',
		portalProps,
		showCloseButton = true,
		closeLabel = 'Close',
		children,
		...restProps
	}: SheetContentProps = $props();
</script>

<SheetPrimitive.Portal {...portalProps}>
	<SheetOverlay />
	<!-- Content sits one rung above the sheet overlay (both at --z-index-sheet). -->
	<SheetPrimitive.Content
		bind:ref
		data-slot="sheet-content"
		style="z-index: calc(var(--z-index-sheet) + 1);"
		class={cn(sheetVariants({ side }), className)}
		{...restProps}
	>
		{@render children?.()}

		{#if showCloseButton}
			<SheetPrimitive.Close
				class="ring-offset-background focus-visible:ring-ring text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm opacity-80 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
			>
				<XIcon aria-hidden="true" />
				<span class="sr-only">{closeLabel}</span>
			</SheetPrimitive.Close>
		{/if}
	</SheetPrimitive.Content>
</SheetPrimitive.Portal>
