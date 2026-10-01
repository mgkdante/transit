<script lang="ts">
	import { cn } from '$lib/utils';
	import { observeStuck } from '$lib/components/shared/stuck';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface ControlsRailProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		label?: string;
		children?: Snippet;
		sticky?: boolean;
		class?: string;
	}

	let {
		label,
		children,
		sticky = false,
		class: className,
		...restProps
	}: ControlsRailProps = $props();

	let railEl = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!sticky || !railEl) return;
		return observeStuck(railEl);
	});
</script>

<div
	bind:this={railEl}
	class={cn('controls-rail', sticky && 'controls-rail--sticky', className)}
	data-slot="controls-rail"
	role={label ? 'group' : undefined}
	aria-label={label}
	{...restProps}
>
	{#if label}
		<span class="controls-rail__label" data-slot="controls-rail-label">{label}</span>
	{/if}
	<div class="controls-rail__body" data-slot="controls-rail-body">
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

	@media (min-width: 1024px) {
		.controls-rail--sticky {
			position: sticky;
			top: var(--chrome-offset);
			z-index: var(--z-rail);
		}

		.controls-rail--sticky[data-stuck='true'] {
			border-bottom: 1px solid var(--border);
			background: color-mix(in srgb, var(--background) 92%, transparent);
			backdrop-filter: blur(16px) saturate(1.1);
		}
	}
</style>
