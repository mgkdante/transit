<!--
  BrandWordmark — the brand wordmark: a word + the orange period. Defaults to the
  yesid.dev house mark ("yesid"); the NavPill passes text="Transit" so the pill
  reads as the PRODUCT home while BrandCluster (topbar/footer) keeps the "yesid"
  parent mark. Same brand treatment either way — font-heading bold, the --primary
  terminal dot, the GSAP hover.

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
	import { isPrefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import { isTouchDevice } from '$lib/motion/utils/device';

	interface Props {
		/** Where the mark links. Default: the parent brand site. */
		href?: string;
		/** The wordmark letters (the orange terminal dot is always appended). */
		text?: string;
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
		// LAZY GSAP: the wordmark hover effect is the ONLY consumer of GSAP in the
		// chrome, and it is a pure flourish. Keep GSAP out of the critical bundle by
		// dynamically importing the action only when it will actually run — i.e.
		// after mount, in the browser, with animation enabled, on a non-touch device,
		// and NOT under prefers-reduced-motion. Reduced-motion / touch users never
		// fetch GSAP at all; everyone else fetches it off the critical path.
		if (!animate || isTouchDevice() || isPrefersReducedMotion()) return;
		void import('$lib/motion/actions')
			.then(({ wordmarkHover }) => {
				// The component may have unmounted before the chunk resolved.
				if (destroyed || !lettersEl) return;
				action = wordmarkHover(lettersEl, { dotEl, autoPlay, autoPlayDelay: 500 });
			})
			.catch(() => {
				// Animation is a pure flourish — if the chunk fails to load, the
				// wordmark simply stays static. Never surface this to the user.
			});
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
	/* Mirrors yesid.dev .nav-wordmark — sizing lives here (not a text-* utility)
	   so "yesid." never wraps and the period stays tight to the letters. */
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
