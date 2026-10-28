<!--
  A card that groups a page's controls under a mono label; with `label` it is a named group.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface ControlsRailProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		label?: string;
		children?: Snippet;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';

	let { label, children, class: className, ...restProps }: ControlsRailProps = $props();
</script>

<div
	class={cn('controls-rail', className)}
	data-slot="controls-rail"
	role={label ? 'group' : undefined}
	aria-label={label}
	{...restProps}
>
	{#if label}
		<span class="controls-rail__label" aria-hidden="true">{label}</span>
	{/if}
	<div class="controls-rail__body">
		{@render children?.()}
	</div>
</div>

<style>
	.controls-rail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		min-width: 0;
	}

	.controls-rail__label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}

	.controls-rail__body {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
	}
</style>
