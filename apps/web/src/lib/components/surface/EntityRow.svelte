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

	interface EntityRowProps {
		/** The navigation intent this row resolves to. */
		target: SurfaceTarget;
		/** Active locale — localizes the href. */
		locale: Locale;
		/** Optional leading mono glyph (decorative). */
		glyph?: string;
		/** Primary row label. */
		title: string;
		/** Optional secondary line under the title. */
		subtitle?: string;
		/** Optional right-aligned meta cell (e.g. an OTP %, a distance). */
		meta?: string;
		/** Optional short list of route ids shown as mono chips under the title. */
		routes?: string[];
		/** Optional extra classes on the anchor. */
		class?: string;
	}

	let {
		target,
		locale,
		glyph,
		title,
		subtitle,
		meta,
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
	{#if glyph}
		<span class="entity-row-glyph" aria-hidden="true">{glyph}</span>
	{/if}
	<span class="entity-row-body">
		<span class="entity-row-title">{title}</span>
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
	{#if meta}
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
		transition: background-color 150ms ease;
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
	.entity-row-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1 1 auto;
		min-width: 0;
	}
	.entity-row-title {
		font-family: var(--font-heading);
		font-weight: 600;
		font-size: var(--text-body);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		margin-top: 0.1rem;
	}
	.entity-row-route {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.1;
		padding: 0.1rem 0.35rem;
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
