<!--
  BrandWordmark — the yesid.dev house wordmark: "yesid" + the orange period.

  Replicated from the yesid.dev navbar (font-heading bold, 18px, no-wrap,
  foreground letters + the --primary dot) INCLUDING the signature GSAP SplitText
  hover animation (four rotating effects + the dot pulse) via use:wordmarkHover.
  transit.yesid.dev is a yesid.dev product, so the chrome carries the parent mark
  and links back to the house site. Reused in the Nav + footer.

  The animation is wired from onMount (not `use:` directly) so the dot element is
  bound when the action initializes; the action self-disables on touch + under
  prefers-reduced-motion.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { cn } from '$lib/utils';
	import { wordmarkHover } from '$lib/motion/actions';

	interface Props {
		/** Where the mark links. Default: the parent brand site. */
		href?: string;
		/** Open in a new tab (external parent-brand link). */
		external?: boolean;
		/** Enable the GSAP wordmark animation (disable in tests / static renders). */
		animate?: boolean;
		/** Autoplay the first effect shortly after mount. */
		autoPlay?: boolean;
		class?: string;
	}

	let {
		href = 'https://yesid.dev',
		external = true,
		animate = true,
		autoPlay = true,
		class: className,
	}: Props = $props();

	let lettersEl: HTMLSpanElement;
	let dotEl: HTMLSpanElement;
	let action: ReturnType<typeof wordmarkHover> | undefined;

	onMount(() => {
		if (!animate) return;
		action = wordmarkHover(lettersEl, { dotEl, autoPlay, autoPlayDelay: 500 });
	});
	onDestroy(() => action?.destroy());
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
	<span bind:this={lettersEl}>yesid</span><span class="text-primary" bind:this={dotEl}>.</span>
</a>

<style>
	/* Mirrors yesid.dev .nav-wordmark — sizing lives here (not a text-* utility)
	   so "yesid." never wraps and the period stays tight to the letters. */
	.brand-wordmark {
		font-size: 18px;
		white-space: nowrap;
		flex-shrink: 0;
		letter-spacing: -0.01em;
		border-radius: var(--radius-sm);
		transition: color var(--duration-fast, 120ms) var(--ease-default, ease);
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
