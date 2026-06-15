<!--
  BrandWordmark — the yesid.dev house wordmark: "yesid" + the orange period.

  Replicated EXACTLY from the yesid.dev navbar (lib/components/layout/Nav.svelte:
  `font-heading font-bold`, 18px, no-wrap, foreground letters + `--primary` dot).
  transit.yesid.dev is a yesid.dev product, so the chrome carries the parent
  brand mark and links back to the parent site. Reused in the TopBar + footer.

  Static (no GSAP SplitText hover — that is yesid.dev marketing motion).
-->
<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		/** Where the mark links. Default: the parent brand site. */
		href?: string;
		/** Open in a new tab (external parent-brand link). */
		external?: boolean;
		class?: string;
	}

	let { href = 'https://yesid.dev', external = true, class: className }: Props = $props();
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
	<span>yesid</span><span class="text-primary">.</span>
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
