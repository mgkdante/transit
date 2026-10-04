<script lang="ts">
	import { cn } from '$lib/utils';
	import { getLocalizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceTarget } from '$lib/nav';

	const localizeHref = getLocalizeHref();

	interface EntityRowBaseProps {
		glyph?: string;
		swatch?: string | null;
		tag?: string;
		title: string;
		subtitle?: string;
		meta?: string;
		metaSlot?: import('svelte').Snippet;
		routes?: string[];
		class?: string;
	}

	export interface EntityRowLinkProps extends EntityRowBaseProps {
		target: SurfaceTarget;
		locale: Locale;
		onSelect?: never;
		ariaLabel?: never;
	}

	export interface EntityRowChoiceProps extends EntityRowBaseProps {
		target?: never;
		locale?: never;
		onSelect: () => void;
		ariaLabel: string;
	}

	export type EntityRowProps = EntityRowLinkProps | EntityRowChoiceProps;

	let {
		target,
		locale,
		onSelect,
		ariaLabel,
		glyph,
		swatch,
		tag,
		title,
		subtitle,
		meta,
		metaSlot,
		routes,
		class: className,
	}: EntityRowProps = $props();

	const href = $derived(target && locale ? localizeHref(routeFor(target), locale) : undefined);
	const rowClass = $derived(cn('entity-row tap-press', className));
</script>

{#snippet rowContent()}
	{#if swatch}
		<span class="entity-row-swatch" style="background:{swatch};" aria-hidden="true"></span>
	{/if}
	{#if glyph}
		<span class="entity-row-glyph" aria-hidden="true">{glyph}</span>
	{/if}
	<span class="entity-row-body">
		<span class="entity-row-title">
			<span class="entity-row-title-text">{title}</span>
			{#if tag}
				<span class="entity-row-tag">{tag}</span>
			{/if}
		</span>
		{#if subtitle}
			<span class="entity-row-subtitle">{subtitle}</span>
		{/if}
		{#if routes && routes.length > 0}
			<span class="entity-row-routes">
				{#each routes as route (route)}
					<span class="entity-row-route">{route}</span>
				{/each}
			</span>
		{/if}
	</span>
	{#if metaSlot}
		<span class="entity-row-meta">{@render metaSlot()}</span>
	{:else if meta}
		<span class="entity-row-meta">{meta}</span>
	{/if}
{/snippet}

{#if href}
	<a {href} data-sveltekit-preload-data="hover" class={rowClass} data-slot="entity-row">
		{@render rowContent()}
	</a>
{:else if onSelect}
	<button
		type="button"
		aria-label={ariaLabel}
		onclick={onSelect}
		class={rowClass}
		data-slot="entity-row"
	>
		{@render rowContent()}
	</button>
{/if}

<style>
	.entity-row {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem 0.875rem;
		border-radius: var(--radius-md);
		color: var(--foreground);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-default);
	}
	button.entity-row {
		width: 100%;
		border: 0;
		background: transparent;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.entity-row:hover {
		background-color: var(--muted);
	}
	.entity-row:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.entity-row-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-subheading);
		line-height: 1;
		color: var(--accent-text);
		flex-shrink: 0;
	}
	.entity-row-swatch {
		flex-shrink: 0;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: var(--radius-pill);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground) 18%, transparent);
	}
	.entity-row-body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1 1 auto;
		min-width: 0;
	}
	.entity-row-title {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}
	.entity-row-title-text {
		font-family: var(--font-heading);
		font-weight: 600;
		font-size: var(--text-body);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.entity-row-tag {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		padding: 0.05rem 0.375rem;
		border-radius: var(--radius-pill);
		background-color: var(--muted);
		color: var(--muted-foreground);
	}
	.entity-row-subtitle {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.entity-row-routes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.125rem;
	}
	.entity-row-route {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.1;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-md);
		background-color: var(--muted);
		color: var(--muted-foreground);
	}
	.entity-row-meta {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}

	@media (prefers-reduced-motion: reduce) {
		.entity-row {
			transition: none;
		}
	}
</style>
