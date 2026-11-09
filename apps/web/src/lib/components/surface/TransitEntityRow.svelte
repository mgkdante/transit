<script lang="ts">
	import { transitDisplay } from '#lib/site/transitDisplayContext.ts';
	const { line } = transitDisplay();
	import type { Snippet } from 'svelte';
	import { readableName } from '#lib/components/surface/readableName.ts';
	import { cn } from '#lib/utils/index.ts';
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { routeFor, type SurfaceTarget } from '#lib/nav/index.ts';

	const localizeHref = getLocalizeHref();

	interface Props {
		target?: SurfaceTarget;
		locale?: Locale;
		onSelect?: () => void;
		ariaLabel?: string;
		glyph?: string;
		swatch?: string | null;
		tag?: string;
		title?: string;
		subtitle?: string;
		meta?: string;
		metaSlot?: Snippet;
		routes?: string[];
		class?: string;
		presentation?: 'row' | 'card' | 'legacy-vehicle';
		density?: 'comfortable' | 'compact';
		navigation?: 'link' | 'choice' | 'static';
		leading?: Snippet;
		identity?: Snippet;
		metadata?: Snippet;
		status?: Snippet;
		actions?: Snippet;
		children?: Snippet;
		href?: string;
	}
	let {
		target,
		locale,
		onSelect,
		ariaLabel,
		glyph,
		swatch,
		tag,
		title = '',
		subtitle,
		meta,
		metaSlot,
		routes,
		class: className,
		presentation = 'row',
		density = 'comfortable',
		navigation,
		leading,
		identity,
		metadata,
		status,
		actions,
		children,
		href: suppliedHref,
	}: Props = $props();

	const href = $derived(
		suppliedHref ?? (target && locale ? localizeHref(routeFor(target), locale) : undefined),
	);
	const rowStyle = $derived(
		density === 'compact' ? '--entity-gap:0.5rem;--entity-padding:0.375rem 0.5rem;' : undefined,
	);
	const rowClass = $derived(cn('entity-row tap-press', className));
</script>

{#snippet rowContent()}
	{#if leading}
		{@render leading()}
	{:else if swatch}
		<span class="entity-row-swatch" style="background:{swatch};" aria-hidden="true"></span>
	{/if}
	{#if glyph}
		<span class="entity-row-glyph" aria-hidden="true">{glyph}</span>
	{/if}
	{#if identity}
		{@render identity()}
	{:else}
		<span class="entity-row-body">
			<span class="entity-row-title">
				<span class="entity-row-title-text readable-name" {title} use:readableName>{title}</span>
				{#if tag}
					<span class="entity-row-tag">{tag}</span>
				{/if}
			</span>
			{#if subtitle}
				<span class="entity-row-subtitle readable-name" title={subtitle} use:readableName
					>{subtitle}</span
				>
			{/if}
			{#if routes && routes.length > 0}
				<span class="entity-row-routes">
					{#each routes as route (route)}
						<span class="entity-row-route">{line(route)}</span>
					{/each}
				</span>
			{/if}
		</span>
	{/if}
	{#if metadata}
		{@render metadata()}
	{:else if metaSlot}
		<span class="entity-row-meta">{@render metaSlot()}</span>
	{:else if meta}
		<span class="entity-row-meta">{meta}</span>
	{/if}
{/snippet}

{#if presentation === 'card'}
	<div class={cn('entity-result-row', className)} data-slot="entity-result-row">
		<div class="entity-result-main" data-slot="entity-result-main">{@render children?.()}</div>
		{#if status}
			<div class="entity-result-status" data-slot="entity-result-status">{@render status()}</div>
		{/if}
		<div class="entity-result-action" data-slot="entity-result-action">{@render actions?.()}</div>
	</div>
{:else if presentation === 'legacy-vehicle'}
	<a
		{href}
		data-sveltekit-preload-data="hover"
		class="vehicle-row"
		data-slot="vehicle-result"
		aria-label={ariaLabel}
	>
		{@render leading?.()}{@render identity?.()}{@render metadata?.()}
	</a>
{:else if href && navigation !== 'static'}
	<a
		{href}
		data-sveltekit-preload-data="hover"
		class={rowClass}
		style={rowStyle}
		data-slot="entity-row"
	>
		{@render rowContent()}
	</a>
{:else if onSelect && navigation !== 'static'}
	<button
		type="button"
		aria-label={[ariaLabel, title, subtitle].filter(Boolean).join(' ')}
		onclick={onSelect}
		class={rowClass}
		style={rowStyle}
		data-slot="entity-row"
	>
		{@render rowContent()}
	</button>
{:else if navigation === 'static'}
	<span class={rowClass} style={rowStyle} data-slot="entity-row">{@render rowContent()}</span>
{/if}
{#if presentation !== 'card'}{@render actions?.()}{/if}

<style>
	.entity-row,
	.vehicle-row {
		display: flex;
		align-items: center;
		gap: var(--entity-gap, 0.875rem);
		padding: var(--entity-padding, 0.75rem 0.875rem);
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
	.entity-row:hover,
	.vehicle-row:hover {
		background-color: var(--muted);
	}
	.entity-row:focus-visible,
	.vehicle-row:focus-visible {
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
		white-space: normal;
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
		white-space: normal;
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

	.entity-result-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		grid-template-areas: 'main status action';
		align-items: center;
		gap: 0.75rem;
		padding-right: 0.5rem;
	}

	.entity-result-main {
		grid-area: main;
		min-width: 0;
	}

	.entity-result-status {
		grid-area: status;
		flex: none;
	}

	.entity-result-action {
		grid-area: action;
		flex: none;
	}

	@media (max-width: 32rem) {
		.entity-result-row {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'main action'
				'status action';
			row-gap: 0.25rem;
		}

		.entity-result-status {
			padding-left: 0.875rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.vehicle-row {
			transition: none;
		}
	}
</style>
