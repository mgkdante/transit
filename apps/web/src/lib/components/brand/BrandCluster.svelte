<script lang="ts">
	import BrandWordmark from '$lib/components/shell/BrandWordmark.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import { YESID_HOUSE_LINK } from '$lib/content/nav';

	interface BrandClusterProps {
		variant: 'topbar' | 'footer';
		productHref: string;
		productAria?: string;
		liveLabel?: string;
	}

	let { variant, productHref, productAria, liveLabel }: BrandClusterProps = $props();
</script>

{#if variant === 'topbar'}
	<div class="flex shrink-0 items-center gap-2 sm:gap-2.5" data-slot="topbar-brand">
		<div class="topbar-brand-mark">
			<BrandWordmark href={YESID_HOUSE_LINK.href} />
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
		<BrandWordmark href={YESID_HOUSE_LINK.href} animate={false} />
		<span class="footer-divider" aria-hidden="true"></span>
		<a
			href={productHref}
			data-testid="footer-wordmark"
			class="footer-product font-heading text-2xl font-bold text-[var(--foreground)]"
		>
			transit
		</a>
	</span>
{/if}

<style>
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
		transition: color var(--duration-fast) var(--ease-default);
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
		transition: color var(--duration-fast) var(--ease-default);
	}

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

	@media (max-width: 768px) {
		.topbar-brand-mark {
			display: none;
		}
		.topbar-divider {
			display: none;
		}
		.topbar-home {
			gap: 0.375rem;
		}
		.topbar-product {
			font-size: var(--text-body);
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
