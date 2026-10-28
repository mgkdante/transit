<!--
  A pill button that reports `pressed` through `aria-pressed`. It is controlled: the caller owns
  the state and changes it in `onclick`, so a refused change never shows as pressed.
-->
<script lang="ts" module>
	import type { HTMLButtonAttributes } from 'svelte/elements';

	export interface ToggleChipProps extends Omit<HTMLButtonAttributes, 'aria-pressed'> {
		pressed: boolean;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';

	let { pressed, class: className, children, ...restProps }: ToggleChipProps = $props();
</script>

<button
	type="button"
	class={cn('toggle-chip', className)}
	data-slot="toggle-chip"
	{...restProps}
	aria-pressed={pressed}
>
	{@render children?.()}
</button>

<style>
	.toggle-chip {
		min-height: var(--size-tap-min);
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--muted-foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.375rem 0.75rem;
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.toggle-chip:hover {
		color: var(--foreground);
	}
	.toggle-chip[aria-pressed='true'] {
		color: var(--primary-foreground);
		background-color: var(--primary);
		border-color: var(--primary);
	}
	.toggle-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.toggle-chip {
			transition: none;
		}
	}
</style>
