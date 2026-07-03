<!--
  EntityRow — a linkable row for one navigable entity (line / stop / vehicle).

  Resolves a semantic `SurfaceTarget` to a real localized `<a href>` via the nav
  layer (routeFor + localizeHref), so deep-links, hover-preload, right-click-open
  and client-side navigation all work for free — SvelteKit intercepts the anchor
  click. (Desktop master/detail panels are deferred to the 9.3 brainstorm; see
  $lib/nav/intent — until that shell is wired, every form factor navigates.)

  Layout: an optional mono glyph, a title (+ optional subtitle) body, and an
  optional right-aligned meta cell. Hover/focus states ride the tokens
  (--muted surface, --ring outline). Tokens, no hex.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceTarget } from '$lib/nav';

	export interface EntityRowProps {
		/** The navigation intent this row resolves to. */
		target: SurfaceTarget;
		/** Active locale — localizes the href. */
		locale: Locale;
		/** Optional leading mono glyph (decorative). */
		glyph?: string;
		/**
		 * Optional GUARDED brand-colour swatch (e.g. a GTFS route colour). This is
		 * the ONE allowed dynamic colour in the row: the caller MUST pass a sanitized
		 * `#rrggbb` (via $lib/search/routeColor) — null/absent renders no swatch.
		 * Applied via an inline `background` bound to the contract value.
		 */
		swatch?: string | null;
		/** Optional mono mode tag chip shown beside the title (e.g. "Métro", "Bus"). */
		tag?: string;
		/** Primary row label. */
		title: string;
		/** Optional secondary line under the title. */
		subtitle?: string;
		/** Optional right-aligned meta cell (e.g. an OTP %, a distance). */
		meta?: string;
		/** Optional inline content for the meta cell (e.g. a ReliabilityBadge). */
		metaSlot?: import('svelte').Snippet;
		/** Optional short list of route ids shown as mono chips under the title. */
		routes?: string[];
		/** Optional extra classes on the anchor. */
		class?: string;
	}

	let {
		target,
		locale,
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

	const href = $derived(localizeHref(routeFor(target), locale));
</script>

<a
	{href}
	data-sveltekit-preload-data="hover"
	class={cn('entity-row', className)}
	data-slot="entity-row"
>
	{#if swatch}
		<!-- The one allowed dynamic colour: a GUARDED GTFS brand swatch (sanitized
		     #rrggbb by the caller), applied via an inline background. -->
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
</a>

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
	/* GUARDED brand-colour swatch — a small round chip carrying the GTFS route
	   hue (the lone dynamic colour; everything else is a token). */
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
	/* Mode tag chip — a quiet mono caption (Métro / Bus …) beside the title. */
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
