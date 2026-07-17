<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '../cn/index.js';

	export interface StopLabelProps extends HTMLAttributes<HTMLDivElement> {
		stop: string;
		label?: string;
		prefix?: string;
		as?: 'div' | 'h1' | 'h2' | 'h3';
		class?: string;
	}

	let {
		stop,
		label,
		prefix = 'ARRÊT',
		as = 'div',
		class: className,
		...restProps
	}: StopLabelProps = $props();

	const hasLabel = $derived(label != null && label !== '');
</script>

<svelte:element this={as} class={cn('stop-label', className)} data-slot="stop-label" {...restProps}>
	<span class="stop-label-num">{prefix} {stop}</span>{#if hasLabel}{' '}· {label}{/if}
</svelte:element>

<style>
	.stop-label {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 400;
		letter-spacing: 2px;
		color: var(--muted-foreground);
		position: relative;
		padding-left: 16px;
		text-transform: uppercase;
	}

	.stop-label-num {
		color: var(--accent-text);
	}

	.stop-label::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--primary);
		box-shadow: 0 0 6px 2px rgb(var(--primary-rgb) / 0.6);
		animation: pulse-glow 2s ease-in-out infinite;
	}

	:global([data-theme='light']) .stop-label::before,
	:global(.theme-light) .stop-label::before {
		outline: 2px solid var(--lamp-bezel);
		outline-offset: 0px;
	}

	@keyframes pulse-glow {
		0%,
		100% {
			opacity: 1;
			box-shadow: 0 0 4px 1px rgb(var(--primary-rgb) / 0.5);
		}
		50% {
			opacity: 0.7;
			box-shadow: 0 0 10px 4px rgb(var(--primary-rgb) / 0.8);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.stop-label::before {
			animation: none;
		}
	}
</style>
