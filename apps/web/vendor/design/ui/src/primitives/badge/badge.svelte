<script lang="ts" module>
	import { cn, twMergeConfig, type WithElementRef } from '../../cn/index.js';
	import type { HTMLAnchorAttributes, HTMLAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	// tv() runs its own tailwind-merge before cn() — pass { twMergeConfig } so the
	// brand @theme vocabulary resolves. Badges frequently carry a dataviz status
	// color via a consumer className (e.g. text-dataviz-status-late); without the
	// shared config tw-merge would misread those names as font-sizes and could
	// silently drop the data mark's color.
	//
	// Chip color vocabulary (geometry stays per-component):
	//   tag        = popover surface + border + secondary-foreground text
	//   tag-active = primary/15 bg + primary/30 border + primary text (brand emphasis)
	//   number     = solid primary pill (interactive count badge)
	// Doctrine: --primary here is an interactive/affordance mark, never a data mark.
	export const badgeVariants = tv(
		{
			base: 'gap-1 rounded-4xl border border-transparent font-mono font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-[3px] [&>svg]:pointer-events-none',
			variants: {
				variant: {
					default:
						'bg-primary text-primary-foreground [a]:hover:bg-primary/80 [a]:active:bg-primary/70',
					secondary:
						'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80 [a]:active:bg-secondary/70',
					destructive:
						'bg-destructive/10 [a]:hover:bg-destructive/20 [a]:active:bg-destructive/30 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/15',
					outline:
						'border-border-subtle text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground [a]:active:bg-muted [a]:active:text-muted-foreground',
					ghost:
						'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50 active:bg-muted active:text-muted-foreground dark:active:bg-muted/50',
					link: 'text-primary underline-offset-4 hover:underline active:underline',
					tag: 'bg-popover text-secondary-foreground border-border',
					'tag-active': 'border-primary/30 bg-primary/15 text-primary',
					number: 'bg-primary text-primary-foreground font-bold',
				},
				size: {
					default: 'h-5 px-2 py-0.5 text-caption',
					xs: 'h-auto px-2 py-0.5 text-[0.6875rem] leading-tight',
					sm: 'h-auto px-3 py-1 text-caption leading-tight',
				},
			},
			compoundVariants: [
				{
					variant: 'number',
					class: 'h-7 w-7 rounded-full p-0 text-micro',
				},
			],
			defaultVariants: {
				variant: 'default',
				size: 'default',
			},
		},
		{ twMergeConfig },
	);

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
	export type BadgeSize = VariantProps<typeof badgeVariants>['size'];

	type BadgeOwnProps = {
		variant?: BadgeVariant;
		size?: BadgeSize;
	};
	type AnchorOnlyProps = Exclude<keyof HTMLAnchorAttributes, keyof HTMLAttributes<HTMLSpanElement>>;
	type ForbidProps<Keys extends PropertyKey> = { [Key in Keys]?: never };

	type BadgeElementProps =
		| (WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> &
				ForbidProps<Exclude<AnchorOnlyProps, 'href'>> & {
				href?: null | undefined;
		  })
		| (WithElementRef<HTMLAnchorAttributes, HTMLAnchorElement> & {
				href: string;
		  });

	export type BadgeProps = BadgeOwnProps & BadgeElementProps;
</script>

<script lang="ts">
	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		size = 'default',
		...elementProps
	}: BadgeProps = $props();
</script>

{#if elementProps.href != null}
	{@const { href, children, ...anchorProps } = elementProps}
	<a
		{...anchorProps}
		bind:this={ref}
		data-slot="badge"
		{href}
		class={cn(badgeVariants({ variant, size }), className)}
	>
		{@render children?.()}
	</a>
{:else}
	{@const { href: _href, children, ...spanProps } = elementProps}
	<span
		{...spanProps}
		bind:this={ref}
		data-slot="badge"
		class={cn(badgeVariants({ variant, size }), className)}
	>
		{@render children?.()}
	</span>
{/if}
