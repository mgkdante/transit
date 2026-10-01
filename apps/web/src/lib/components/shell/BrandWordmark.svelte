<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { cn } from '$lib/utils';
	import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { isTouchDevice } from '@yesid/motion/utils/device';

	interface Props {
		href?: string;
		text?: string;
		external?: boolean;
		animate?: boolean;
		autoPlay?: boolean;
		class?: string;
	}

	let {
		href = 'https://yesid.dev',
		text = 'yesid',
		external = true,
		animate = true,
		autoPlay = true,
		class: className,
	}: Props = $props();

	let lettersEl: HTMLSpanElement;
	let dotEl: HTMLSpanElement;
	let action: { destroy(): void } | undefined;
	let destroyed = false;

	onMount(() => {
		if (!animate || isTouchDevice() || isPrefersReducedMotion()) return;
		void import('@yesid/motion/actions')
			.then(({ wordmarkHover }) => {
				if (destroyed || !lettersEl) return;
				action = wordmarkHover(lettersEl, { dotEl, autoPlay, autoPlayDelay: 500 });
			})
			.catch(() => {});
	});
	onDestroy(() => {
		destroyed = true;
		action?.destroy();
	});
</script>

<a
	{href}
	target={external ? '_blank' : undefined}
	rel={external ? 'noopener noreferrer' : undefined}
	class={cn(
		'brand-wordmark inline-flex items-center font-heading font-bold text-foreground',
		className,
	)}
	data-slot="brand-wordmark"
>
	<span bind:this={lettersEl}>{text}</span><span class="text-primary" bind:this={dotEl}>.</span>
</a>

<style>
	.brand-wordmark {
		font-size: 18px;
		white-space: nowrap;
		flex-shrink: 0;
		letter-spacing: -0.01em;
		border-radius: var(--radius-sm);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.brand-wordmark:hover {
		color: var(--primary);
	}
	.brand-wordmark:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.brand-wordmark {
			transition: none;
		}
	}
</style>
