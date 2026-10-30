<script lang="ts">
	import { Wordmark } from '@yesid/ui/brand';
	import { YESID_HOUSE_LINK } from '$lib/content/nav';

	let { productHref }: { productHref: string } = $props();
</script>

<span class="flex items-center gap-2">
	<Wordmark href={YESID_HOUSE_LINK.href} external animate={false} class="text-lg" />
	<span class="footer-divider" aria-hidden="true"></span>
	<a
		href={productHref}
		data-testid="footer-wordmark"
		class="footer-product font-heading text-2xl font-bold text-[var(--foreground)]"
	>
		transit
	</a>
</span>

<style>
	.footer-divider {
		display: inline-block;
		width: 2px;
		height: 18px;
		background: var(--border-brand);
		flex-shrink: 0;
	}
	.footer-product {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--size-tap-min);
		white-space: nowrap;
		letter-spacing: -0.01em;
		border-radius: var(--radius-sm);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.footer-product:hover {
		color: var(--primary);
	}
	.footer-product:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.footer-product {
			transition: none;
		}
	}
</style>
