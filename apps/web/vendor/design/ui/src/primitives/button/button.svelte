<script lang="ts" module>
	import { cn, twMergeConfig, type WithElementRef } from '../../cn/index.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	// tv() runs its own tailwind-merge before cn() ever sees the classes — feed
	// it the same @theme vocabulary (via { twMergeConfig }) so brand font-size
	// utilities (text-body, text-small, ...) survive next to real color classes
	// and dataviz color names aren't misread as font-sizes.
	//
	// Doctrine: orange --primary is INTERACTIVE-only. The `default` button is an
	// interactive affordance, so --primary is correct here. The yellow
	// `conversion` variant from the upstream marketing app is dropped entirely —
	// transit has no "talk to sales" CTA and --accent must never read as data.
	export const buttonVariants = tv(
		{
			base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-control font-medium focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px aria-invalid:ring-3 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
			variants: {
				variant: {
					default:
						'bg-primary text-primary-foreground hover:bg-primary-hover [a]:hover:bg-primary/80',
					outline:
						'border-border-subtle bg-transparent text-foreground hover:border-primary hover:text-primary aria-expanded:border-primary aria-expanded:text-primary',
					secondary:
						'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
					ghost:
						'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground',
					destructive:
						'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30',
					link: 'text-primary underline-offset-4 hover:underline',
				},
				size: {
					default:
						'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
					xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-caption in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
					sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
					lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
					icon: 'size-8',
					'icon-xs':
						"size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
					'icon-sm':
						'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
					'icon-lg': 'size-9',
					'cta-sm': 'gap-2 px-5 py-2.5 text-control font-semibold',
					cta: 'gap-2 px-6 py-3 text-body font-semibold',
					'cta-lg': 'gap-2 px-8 py-4 text-subheading font-semibold',
				},
			},
			compoundVariants: [
				{
					variant: 'default',
					size: ['cta-sm', 'cta', 'cta-lg'],
					class: 'hover:-translate-y-px hover:shadow-glow-sm',
				},
			],
			defaultVariants: {
				variant: 'default',
				size: 'default',
			},
		},
		{ twMergeConfig },
	);

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	type ButtonOwnProps = {
		variant?: ButtonVariant;
		size?: ButtonSize;
	};
	type ForbidProps<Keys extends PropertyKey> = { [Key in Keys]?: never };
	type AnchorOnlyProps = Exclude<keyof HTMLAnchorAttributes, keyof HTMLButtonAttributes>;
	type ButtonOnlyProps = Exclude<keyof HTMLButtonAttributes, keyof HTMLAnchorAttributes>;

	type ButtonElementProps =
		| (WithElementRef<HTMLButtonAttributes, HTMLButtonElement> &
				ForbidProps<Exclude<AnchorOnlyProps, 'href'>> & {
				href?: null | undefined;
		  })
		| (WithElementRef<HTMLAnchorAttributes, HTMLAnchorElement> &
				ForbidProps<Exclude<ButtonOnlyProps, 'disabled'>> & {
				href: string;
				disabled?: boolean;
		  });

	export type ButtonProps = ButtonOwnProps & ButtonElementProps;
</script>

<script lang="ts">
	// F (motion wiring): pressBounce gives buttons a tactile <200ms scale bounce on
	// touch (SAFE-ALWAYS tier — the action self-gates to touch devices and stays under
	// PRM per the package policy). Pointer users already carry active:translate-y-px
	// from the base variant, so no .tap-press CSS is layered here (that would double
	// the press scale). Vendored action, never edited.
	import { pressBounce } from '@yesid/motion';

	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		...elementProps
	}: ButtonProps = $props();
</script>

{#if elementProps.href != null}
	{@const { href, disabled, children, ...anchorProps } = elementProps}
	<a
		{...anchorProps}
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled || undefined}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		use:pressBounce
	>
		{@render children?.()}
	</a>
{:else}
	{@const { href: _href, type = 'button', disabled, children, ...buttonProps } = elementProps}
	<button
		{...buttonProps}
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		use:pressBounce
	>
		{@render children?.()}
	</button>
{/if}
