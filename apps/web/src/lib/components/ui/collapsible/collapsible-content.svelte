<!--
  CollapsibleContent — bits-ui Content wrapper with the yesid.dev open/close idiom.

  Smooth height + opacity transition on open/close, driven by bits-ui's
  data-state and the grid-template-rows 0fr → 1fr trick (no fixed height, no
  measuring). forceMount keeps the node in the DOM so the transition can run
  both ways; the inner overflow:hidden div clips the collapsing content.
  Timing is --duration-slow / --ease-default, reduced-motion-guarded.

  Stays a clean wrapper: every prop is forwarded, and the grid/clip scaffold is
  the only structure added so the animation works without a consumer host.
-->
<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';

	let {
		ref = $bindable(null),
		forceMount = true,
		class: className,
		children,
		...restProps
	}: CollapsiblePrimitive.ContentProps = $props();
</script>

<CollapsiblePrimitive.Content
	bind:ref
	{forceMount}
	data-slot="collapsible-content"
	class={className}
	{...restProps}
>
	{#snippet child({ props })}
		<div
			{...props}
			class="collapsible-content {props.class ?? ''}"
			inert={props['data-state'] === 'closed'}
			aria-hidden={props['data-state'] === 'closed' ? 'true' : undefined}
		>
			<div class="collapsible-content__inner">
				{@render children?.()}
			</div>
		</div>
	{/snippet}
</CollapsiblePrimitive.Content>

<style>
	/* yesid.dev section-body idiom: animate the grid track from 0fr → 1fr so the
	   content height eases open/closed without measuring. The inner div clips
	   the overflow during the collapse. */
	.collapsible-content {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows var(--duration-slow) var(--ease-default),
			opacity var(--duration-slow) var(--ease-default);
	}

	.collapsible-content[data-state='open'] {
		grid-template-rows: 1fr;
		opacity: 1;
	}

	.collapsible-content__inner {
		min-height: 0;
		overflow: hidden;
	}

	@media (prefers-reduced-motion: reduce) {
		.collapsible-content {
			transition: none;
		}
	}
</style>
