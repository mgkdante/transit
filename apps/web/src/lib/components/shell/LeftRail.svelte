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
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import MapIcon from '@lucide/svelte/icons/map';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import RouteIcon from '@lucide/svelte/icons/route';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, delocalizePath, getLocale, localizeHref } from '$lib/i18n';
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
	const navItems = $derived([
		{
			key: 'map',
			href: localizeHref('/map', locale),
			label: locale === 'fr' ? 'Carte' : 'Map',
			meta: locale === 'fr' ? 'réseau en direct' : 'live network',
			active: currentPath === '/map',
		},
		{
			key: 'lines',
			href: localizeHref('/lines', locale),
			label: locale === 'fr' ? 'Lignes' : 'Lines',
			meta: locale === 'fr' ? 'itinéraires et directions' : 'routes and directions',
			active: currentPath === '/lines' || currentPath.startsWith('/route/'),
		},
		{
			key: 'stops',
			href: localizeHref('/stops', locale),
			label: locale === 'fr' ? 'Arrêts' : 'Stops',
			meta: locale === 'fr' ? 'départs et horaires' : 'departures and schedules',
			active: currentPath === '/stops' || currentPath.startsWith('/stop/'),
		},
		{
			key: 'network',
			href: localizeHref('/network', locale),
			label: locale === 'fr' ? 'Réseau' : 'Network',
			meta: locale === 'fr' ? 'fiabilité et santé' : 'reliability and health',
			active: currentPath === '/network',
		},
	]);
</script>

<nav
	class={cn('left-rail flex h-full w-full min-w-0 shrink-0 flex-col border-r border-border bg-card', className)}
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

	<!-- Rail body — scrolls internally so the map stage stays put. -->
	<ScrollArea class="min-h-0 flex-1" data-slot="left-rail-body">
		<div class="p-3">
			{#if children && !collapsed}
				{@render children()}
			{:else}
				<div class="left-rail-nav" data-slot="left-rail-default-nav">
					{#each navItems as item (item.key)}
						<a
							href={item.href}
							class="left-rail-link"
							aria-label={`${item.label} ${item.meta}`}
							aria-current={item.active ? 'page' : undefined}
						>
							<span class="left-rail-icon" aria-hidden="true">
								{#if item.key === 'map'}
									<MapIcon size={17} strokeWidth={2.1} />
								{:else if item.key === 'lines'}
									<RouteIcon size={17} strokeWidth={2.1} />
								{:else if item.key === 'stops'}
									<CircleStopIcon size={17} strokeWidth={2.1} />
								{:else}
									<ActivityIcon size={17} strokeWidth={2.1} />
								{/if}
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
		outline: none;
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
	}

	@media (prefers-reduced-motion: reduce) {
		.left-rail-link {
			transition: none;
		}
	}
</style>
