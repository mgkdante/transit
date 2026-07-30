<!--
	@component
	FooterLink preserves yesid.dev's underline-draw recipe and selects an anchor
	when href is supplied or a button otherwise. Transit adds position: relative,
	a ::after tap overlay, and reduced-motion transition removal; the shared leaf
	keeps yesid as the underline source and uses the frozen literal tap floor.
-->
<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import type { WithElementRef } from '../../cn/index.js';

	type ForbidProps<Keys extends PropertyKey> = { [Key in Keys]?: never };
	type AnchorOnlyProps = Exclude<keyof HTMLAnchorAttributes, keyof HTMLButtonAttributes>;
	type ButtonOnlyProps = Exclude<keyof HTMLButtonAttributes, keyof HTMLAnchorAttributes>;

	type FooterLinkElementProps =
		| (WithElementRef<HTMLButtonAttributes, HTMLButtonElement> &
				ForbidProps<Exclude<AnchorOnlyProps, 'href'>> & {
				href?: null | undefined;
		  })
		| (WithElementRef<HTMLAnchorAttributes, HTMLAnchorElement> &
				ForbidProps<ButtonOnlyProps> & {
				href: string;
		  });

	export type FooterLinkProps = FooterLinkElementProps;
</script>

<script lang="ts">
	import { cn } from '../../cn/index.js';

	let {
		ref = $bindable(null),
		class: className,
		'data-slot': dataSlot = 'footer-link',
		...elementProps
	}: FooterLinkProps = $props();
</script>

{#if elementProps.href != null}
	{@const { href, children, ...anchorProps } = elementProps}
	<a
		{...anchorProps}
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'footer-link inline-flex min-h-[var(--size-tap-min,44px)] items-center self-start text-small text-[var(--secondary-foreground)] transition-colors hover:text-primary active:text-primary',
			className,
		)}
		{href}
	>
		{@render children?.()}
	</a>
{:else}
	{@const { href: _href, type = 'button', children, ...buttonProps } = elementProps}
	<button
		{...buttonProps}
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'footer-link inline-flex min-h-[var(--size-tap-min,44px)] items-center self-start text-left text-small text-[var(--secondary-foreground)] transition-colors hover:text-primary active:text-primary',
			className,
		)}
		{type}
	>
		{@render children?.()}
	</button>
{/if}

<style>
	.footer-link {
		background-image: linear-gradient(var(--primary), var(--primary));
		background-repeat: no-repeat;
		background-position: 0 100%;
		background-size: 0% 1px;
		min-height: var(--size-tap-min, 44px);
		transition:
			background-size var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-default);
	}

	.footer-link:hover,
	.footer-link:focus-visible {
		background-size: 100% 1px;
	}
</style>
