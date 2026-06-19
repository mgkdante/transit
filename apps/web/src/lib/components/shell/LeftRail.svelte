<!--
  LeftRail — the desktop left wayfinding column (w300).

  A fixed-width vertical column holding the navigation / filter affordances. In
  slice 9.2 it carries NO Family data, so its content is a single named-snippet
  slot the page fills; absent a snippet it renders a quiet empty state. The rail
  scrolls internally (header stays, body scrolls) so the MapStage never moves.

  Adapted from the yesid.dev chrome column idioms — re-themed to the transit
  board, stripped of gsap/marketing. Tokens only; surfaces SOLID (bg-card).

  a11y: <nav> landmark with a labelled region; the empty state is a plain,
  screen-reader-legible note (not colour-only).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, delocalizePath, getLocale, localizeHref } from '$lib/i18n';
	import { SURFACE_NAV, isSurfaceActive } from '$lib/content/nav';
	import { navIcons } from './navIcons';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';

	interface LeftRailProps {
		/** Active locale (prop wins; falls back to context for isolated renders). */
		locale?: Locale;
		/** Full current URL so the desktop rail can mark the active route. */
		url?: URL;
		/** Optional heading shown above the rail body. */
		heading?: string;
		/** Collapsed rail keeps nav icons visible and hides copy. */
		collapsed?: boolean;
		/** Fired when the collapse/expand control is activated. */
		ontogglecollapse?: () => void;
		/** Rail body — the page fills this; empty state shows when omitted. */
		children?: Snippet;
		class?: string;
	}

	let {
		locale: localeProp,
		url,
		heading,
		collapsed = false,
		ontogglecollapse,
		children,
		class: className,
	}: LeftRailProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const defaultHeading = $derived(locale === 'fr' ? 'Prochains arrêts' : 'Next stations');
	const navAria = $derived(locale === 'fr' ? 'Navigation du réseau' : 'Network navigation');
	const collapseAria = $derived(locale === 'fr' ? 'Réduire la navigation' : 'Collapse navigation');
	const expandAria = $derived(locale === 'fr' ? 'Ouvrir la navigation' : 'Expand navigation');
	const currentPath = $derived(delocalizePath(url?.pathname ?? '/'));
	const navItems = $derived(
		SURFACE_NAV.map((item) => ({
			key: item.key,
			href: localizeHref(item.href, locale),
			label: item.label[locale],
			meta: item.description[locale],
			active: isSurfaceActive(item, currentPath),
		})),
	);
</script>

<nav
	class={cn(
		'left-rail flex h-full w-full min-w-0 shrink-0 flex-col border-r border-border bg-card',
		className,
	)}
	aria-label={navAria}
	data-slot="left-rail"
	data-open={collapsed ? 'false' : 'true'}
>
	<!-- Rail header — sticky above the scrolling body. -->
	<div class="left-rail-head flex h-12 shrink-0 items-center border-b border-border-subtle px-4">
		<button
			type="button"
			class="tap-press left-rail-toggle inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={collapsed ? expandAria : collapseAria}
			aria-expanded={!collapsed}
			onclick={() => ontogglecollapse?.()}
			data-slot="left-rail-toggle"
		>
			{#if collapsed}
				<PanelLeftOpenIcon size={15} strokeWidth={2.3} aria-hidden="true" />
			{:else}
				<PanelLeftCloseIcon size={15} strokeWidth={2.3} aria-hidden="true" />
			{/if}
		</button>
		{#if !collapsed}
			<div class="min-w-0 flex-1">
				<SectionLabel text={heading ?? defaultHeading} variant="station" />
			</div>
		{/if}
	</div>

	<!-- Rail body — scrolls internally so the map stage stays put. The padded
	     wrapper reserves a stable scrollbar gutter so content never shifts when a
	     scrollbar appears as the rail is dragged narrower. -->
	<ScrollArea class="min-h-0 flex-1" data-slot="left-rail-body">
		<div class="left-rail-body-inner p-3">
			{#if children && !collapsed}
				{@render children()}
			{:else}
				<div class="left-rail-nav" data-slot="left-rail-default-nav">
					{#each navItems as item (item.key)}
						{@const Icon = navIcons[item.key]}
						<a
							href={item.href}
							class="left-rail-link"
							aria-label={`${item.label} ${item.meta}`}
							aria-current={item.active ? 'page' : undefined}
						>
							<span class="left-rail-icon" aria-hidden="true">
								<Icon size={17} strokeWidth={2.1} />
							</span>
							{#if !collapsed}
								<span class="left-rail-copy">
									<span>{item.label}</span>
									<small>{item.meta}</small>
								</span>
							{/if}
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</ScrollArea>
</nav>

<style>
	.left-rail {
		--left-rail-tile-size: 3.35rem;
		overflow: hidden;
		/* Make the rail a size container so its CONTENT reflows against the rail's
		   own width as it is dragged — independent of the viewport. The expanded
		   nav rows progressively drop their description, then tighten, BEFORE the
		   hard icon-only collapse, so a narrow rail reflows gracefully instead of
		   clipping/truncating its labels. */
		container: left-rail / inline-size;
	}

	/* Reserve a stable scrollbar gutter so the rail body never shifts horizontally
	   when a vertical scrollbar appears mid-drag. */
	.left-rail-body-inner {
		scrollbar-gutter: stable;
	}

	.left-rail[data-open='true'] .left-rail-head {
		gap: 0.5rem;
	}

	.left-rail[data-open='false'] .left-rail-head {
		justify-content: center;
	}

	.left-rail-nav {
		display: grid;
		gap: 0.4rem;
	}

	.left-rail[data-open='false'] .left-rail-nav {
		justify-items: center;
	}

	.left-rail-link {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.75rem;
		height: var(--left-rail-tile-size);
		min-height: var(--left-rail-tile-size);
		padding: 0.6rem 0.7rem;
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 84%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition:
			color var(--duration-fast, 120ms) var(--ease-default, ease),
			background var(--duration-fast, 120ms) var(--ease-default, ease),
			border-color var(--duration-fast, 120ms) var(--ease-default, ease);
	}

	.left-rail[data-open='false'] .left-rail-link {
		justify-content: center;
		gap: 0;
		width: var(--left-rail-tile-size);
		height: var(--left-rail-tile-size);
		min-height: var(--left-rail-tile-size);
		padding: 0.6rem;
	}

	.left-rail-link:hover,
	.left-rail-link:focus-visible,
	.left-rail-link[aria-current='page'] {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border) 56%);
	}

	/* Keyboard focus stays DISTINCT from hover/current — a visible ring, not just
	   the colour shift (which a keyboard user can't tell from the active page). */
	.left-rail-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.left-rail-icon {
		display: inline-flex;
		width: 2rem;
		height: 2rem;
		flex: none;
		align-items: center;
		justify-content: center;
		color: currentColor;
		background: color-mix(in srgb, currentColor 6%, transparent);
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: var(--radius-sm);
	}

	.left-rail-copy {
		display: grid;
		min-width: 0;
		gap: 0.15rem;
		/* Ease the copy in/out on collapse-expand (the row text fading rather than
		   snapping); guarded under prefers-reduced-motion below. */
		transition:
			opacity var(--duration-normal, 180ms) var(--ease-default, ease),
			transform var(--duration-normal, 180ms) var(--ease-out, ease);
	}

	.left-rail-copy span {
		overflow: hidden;
		font-family: var(--font-heading);
		font-size: 0.96rem;
		font-weight: 700;
		line-height: 1.05;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.left-rail-copy small {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--muted-foreground);
		text-overflow: ellipsis;
		white-space: nowrap;
		/* Reflow gate: the description fades out (see the @container rule) before the
		   label, so a narrowing rail sheds the secondary line gracefully. */
		transition: opacity var(--duration-fast, 120ms) var(--ease-default, ease);
	}

	/* Container-query reflow — drives the EXPANDED rail's content off the rail's own
	   inline size so it degrades gracefully as it is dragged narrower, well before
	   the icon-only collapse. Two steps: drop the secondary description, then tighten
	   the row gap so the primary label keeps breathing room instead of truncating. */
	@container left-rail (max-width: 12rem) {
		.left-rail-copy small {
			height: 0;
			margin: 0;
			opacity: 0;
			pointer-events: none;
		}
	}

	@container left-rail (max-width: 9.5rem) {
		.left-rail-link {
			gap: 0.5rem;
			padding-inline: 0.55rem;
		}
		.left-rail-copy span {
			font-size: 0.9rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.left-rail-link,
		.left-rail-copy,
		.left-rail-copy small {
			transition: none;
		}
	}
</style>
