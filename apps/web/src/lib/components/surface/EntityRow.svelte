<!--
  EntityRow — a linkable row for one navigable entity (line / stop / vehicle).

  Resolves a semantic `SurfaceTarget` through the nav layer: it renders a real
  localized `<a>` (so deep-links, hover-preload and right-click-open all work),
  but on desktop the click is intercepted to swap the in-memory detail panel
  (openSurface) instead of navigating — "panels, not pages". Mobile lets the link
  navigate normally.

  Layout: an optional mono glyph, a title (+ optional subtitle) body, and an
  optional right-aligned meta cell. Hover/focus states ride the tokens
  (--muted surface, --ring outline). Tokens, no hex.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, openSurface, isDesktopViewport, type SurfaceTarget } from '$lib/nav';

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
		/** Optional extra classes on the anchor. */
		class?: string;
	}

	let { target, locale, glyph, title, subtitle, meta, class: className }: EntityRowProps = $props();

	const href = $derived(localizeHref(routeFor(target), locale));

	// Desktop: intercept and swap the detail panel (no nav). Mobile: let the link
	// navigate. Modified clicks (new tab) and non-primary buttons pass through.
	function onClick(e: MouseEvent) {
		if (e.defaultPrevented) return;
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		if (!isDesktopViewport()) return;
		e.preventDefault();
		openSurface(target);
	}
</script>

<a
	{href}
	data-sveltekit-preload-data="hover"
	onclick={onClick}
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
