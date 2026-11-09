<script lang="ts">
	import { Button, type ButtonProps } from '@yesid/ui/button';
	let { checked, children, ...props }: ButtonProps & { checked: boolean } = $props();
</script>

<Button
	variant="ghost"
	size="sm"
	{...props}
	role="switch"
	aria-checked={checked}
	data-on={checked}
	class={['transit-switch-row', props.class].filter(Boolean).join(' ')}
>
	{@render children?.()}
	<span class="transit-switch-track" aria-hidden="true"
		><span class="transit-switch-thumb"></span></span
	>
</Button>

<style>
	:global(.transit-switch-row) {
		min-block-size: var(--size-tap-min);
		min-inline-size: var(--size-tap-min);
	}
	:global(.transit-switch-track) {
		position: relative;
		flex: none;
		width: 1.85rem;
		height: 1.05rem;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--border) 70%, transparent);
		transition: background-color var(--duration-fast) var(--ease-default);
	}
	:global(.transit-switch-row[aria-checked='true'] .transit-switch-track) {
		background: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	:global(.transit-switch-thumb) {
		position: absolute;
		top: 50%;
		left: 0.125rem;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--card);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 30%, transparent);
		transform: translate(0, -50%);
		transition: transform var(--duration-fast) var(--ease-out);
	}
	:global(.transit-switch-row[aria-checked='true'] .transit-switch-thumb) {
		transform: translate(0.8rem, -50%);
	}
	:global(.transit-switch-track) {
		order: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.transit-switch-track),
		:global(.transit-switch-thumb) {
			transition: none;
		}
	}
</style>
