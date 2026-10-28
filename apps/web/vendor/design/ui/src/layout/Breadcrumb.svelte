<!--
  A breadcrumb trail: a navigation named by `label` with one link per ancestor and the current page
  last. It renders nothing for fewer than two items. The trail's JSON-LD comes from
  `buildBreadcrumbListJsonLd` in `@yesid/seo-kit/jsonld`, with absolute URLs.
-->
<script lang="ts" module>
	export interface BreadcrumbItem {
		name: string;
		href: string;
	}

	export interface BreadcrumbProps {
		items: readonly BreadcrumbItem[];
		label: string;
		class?: string;
	}
</script>

<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { cn } from '../cn/index.js';

	let { items, label, class: className }: BreadcrumbProps = $props();
</script>

{#if items.length > 1}
	<nav class={cn('breadcrumb', className)} aria-label={label} data-slot="breadcrumb">
		<ol class="breadcrumb-list">
			{#each items as item, i (item.href)}
				<li class="breadcrumb-item">
					{#if i > 0}
						<ChevronRightIcon
							class="breadcrumb-sep"
							size={12}
							strokeWidth={2.2}
							aria-hidden="true"
						/>
					{/if}
					{#if i === items.length - 1}
						<span class="breadcrumb-current" aria-current="page">{item.name}</span>
					{:else}
						<a class="breadcrumb-link" href={item.href}>{item.name}</a>
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
