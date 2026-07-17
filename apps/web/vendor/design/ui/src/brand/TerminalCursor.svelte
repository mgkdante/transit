<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '../cn/index.js';

	let { class: className, ...restProps }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span {...restProps} class={cn('terminal-cursor', className)} aria-hidden="true"></span>

<style>
	.terminal-cursor {
		display: inline-block;
		width: 0.5rem;
		height: 0.875rem;
		margin-left: 0.25rem;
		vertical-align: text-bottom;
		background: var(--accent-text);
		animation: terminal-blink 1s step-end infinite;
	}

	@keyframes terminal-blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.terminal-cursor {
			animation: none;
		}
	}
</style>
