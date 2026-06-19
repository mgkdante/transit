<!--
  BrandCluster — the shared parent-mark + product-mark cluster.

  transit.yesid.dev is a yesid.dev product, so the chrome carries the house
  "yesid." wordmark · a bold brand-border divider · the "transit" product mark.
  Both the TopBar (app chrome) and the Footer rendered this exact three-part
  cluster by hand; this primitive is now the single source of that structure so
  a brand tweak happens in one place.

  Two `variant`s keep each call site's CSS hooks + behaviour intact:
    topbar — links the product mark to `/`, shows the live LED dot, and emits the
             `topbar-brand-mark` / `topbar-divider` / `topbar-home` hooks plus the
             ≤760px collapse (drop the parent mark + divider, tighten the link).
    footer — links the product mark to the localized home, no live dot, animation
             off (static footer chrome), and emits the `footer-divider` /
             `footer-home` hooks.

  DOCTRINE: orange --primary is INTERACTIVE-only. The live dot (topbar variant)
  is the lone "system is live" affordance — a StatusDot data/affordance mark, not
  --primary. The product mark only colours --primary on hover/focus.
-->
<script lang="ts">
	import BrandWordmark from '$lib/components/shell/BrandWordmark.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';

	interface BrandClusterProps {
		/** Which chrome surface this renders in — drives hooks + behaviour. */
		variant: 'topbar' | 'footer';
		/** Product-mark target (`/` for topbar; the localized home for footer). */
		productHref: string;
		/** aria-label on the topbar product-mark link (the home label). */
		productAria?: string;
		/** Live-tier label for the topbar LED dot ("Live" / "En direct"). */
		liveLabel?: string;
	}

	let { variant, productHref, productAria, liveLabel }: BrandClusterProps = $props();
</script>

{#if variant === 'topbar'}
	<div class="flex shrink-0 items-center gap-2 sm:gap-2.5" data-slot="topbar-brand">
		<div class="topbar-brand-mark">
			<BrandWordmark href="https://yesid.dev" />
		</div>
		<span class="topbar-divider" aria-hidden="true"></span>
		<a href={productHref} class="topbar-home" aria-label={productAria} data-slot="topbar-home">
			<span class="topbar-product">transit</span>
			<span class="inline-flex items-center gap-1.5" data-slot="topbar-live">
				<StatusDot color="orange" pulse label={liveLabel} />
				<span class="label-station hidden text-[0.625rem] sm:inline">{liveLabel}</span>
			</span>
		</a>
	</div>
{:else}
	<span class="flex items-center gap-2">
		<BrandWordmark href="https://yesid.dev" animate={false} />
		<span class="footer-divider" aria-hidden="true"></span>
		<a
			href={productHref}
			data-testid="footer-home"
			class="footer-product font-heading text-xl font-bold text-[var(--foreground)]"
		>
			transit
		</a>
	</span>
{/if}

<style>
	/* TopBar variant — the divider is the same bold brand-border rule as the
	   yesid.dev nav pill; the home link colours --primary on hover/focus. */
	.topbar-divider {
		display: inline-block;
		width: 2px;
		height: 18px;
		background: var(--border-brand);
		flex-shrink: 0;
	}
	.topbar-brand-mark {
		display: inline-flex;
	}
	.topbar-home {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: var(--radius-sm);
		transition: color var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	.topbar-home:hover .topbar-product {
		color: var(--primary);
	}
	.topbar-home:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.topbar-product {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: 1rem;
		color: var(--foreground);
		white-space: nowrap;
		transition: color var(--duration-fast, 120ms) var(--ease-default, ease);
	}

	/* Footer variant — brand divider between the parent wordmark and the product
	   mark; the product mark colours --primary on hover/focus. */
	.footer-divider {
		display: inline-block;
		width: 2px;
		height: 18px;
		background: var(--border-brand);
		flex-shrink: 0;
	}
	.footer-product {
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

	/* TopBar: below the brand breakpoint, drop the parent mark + divider and
	   tighten the home link — the same responsive collapse TopBar carried inline. */
	@media (max-width: 760px) {
		.topbar-brand-mark {
			display: none;
		}
		.topbar-divider {
			display: none;
		}
		.topbar-home {
			gap: 0.35rem;
		}
		.topbar-product {
			font-size: 0.98rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.topbar-home,
		.topbar-product,
		.footer-product {
			transition: none;
		}
	}
</style>
