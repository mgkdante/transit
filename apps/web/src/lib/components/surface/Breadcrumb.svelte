<script lang="ts">
	import { type Locale, localizeHref } from '$lib/i18n';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { BreadcrumbTrailItem } from '$lib/seo/routeSeo';

	export interface BreadcrumbProps {
		trail: readonly BreadcrumbTrailItem[];
		locale: Locale;
		class?: string;
	}

	let { trail, locale, class: className }: BreadcrumbProps = $props();

	const navAria = $derived(locale === 'fr' ? "Fil d'Ariane" : 'Breadcrumb');
	const crumbs = $derived(
		trail.map((crumb, i) => ({
			name: crumb.name,
			href: localizeHref(crumb.path, locale),
			isLast: i === trail.length - 1,
		})),
	);
</script>

{#if crumbs.length > 1}
	<nav class={['breadcrumb', className]} aria-label={navAria} data-slot="breadcrumb">
		<ol class="breadcrumb-list">
			{#each crumbs as crumb, i (crumb.href)}
				<li class="breadcrumb-item">
					{#if i > 0}
						<ChevronRightIcon
							class="breadcrumb-sep"
							size={12}
							strokeWidth={2.2}
							aria-hidden="true"
						/>
					{/if}
					{#if crumb.isLast}
						<span class="breadcrumb-current" aria-current="page">{crumb.name}</span>
					{:else}
						<a class="breadcrumb-link" href={crumb.href}>{crumb.name}</a>
					{/if}
				</li>
			{/each}
		</ol>
	</nav>
{/if}

<style>
	.breadcrumb {
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	.breadcrumb-list {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.125rem 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.breadcrumb-item {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
	}
	.breadcrumb-item :global(.breadcrumb-sep) {
		flex: none;
		color: var(--muted-foreground);
		opacity: 0.6;
	}
	.breadcrumb-link {
		min-width: 0;
		overflow: hidden;
		color: var(--muted-foreground);
		text-decoration: none;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease-out);
	}
	.breadcrumb-link:hover {
		color: var(--primary);
	}
	.breadcrumb-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}
	.breadcrumb-current {
		min-width: 0;
		overflow: hidden;
		color: var(--foreground);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		.breadcrumb-link {
			transition: none;
		}
	}
</style>
