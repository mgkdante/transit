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
	import { SURFACE_NAV, AUDIT_NAV, isSurfaceActive } from '$lib/content/nav';
	import { navIcons, auditIcons } from './navIcons';
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
	// The Audit group heading + its accessible name. FR "Vérification" is the honest
	// term for the accountability/meta surfaces (records examined to hold the service
	// to account), not the loanword "Audit".
	const auditLabel = $derived(locale === 'fr' ? 'Vérification' : 'Audit');
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
	const auditItems = $derived(
		AUDIT_NAV.map((item) => ({
			key: item.key,
			href: localizeHref(item.href, locale),
			label: item.label[locale],
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
	data-testid="left-rail"
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
			<!-- Active rail body — the page's custom rail snippet when expanded, else the
			     default primary nav (also the collapsed icon-only treatment). The Audit
			     group renders BELOW this on EVERY surface so it stays reachable in the
			     expanded rail even when a page supplies its own rail content. -->
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

			<!-- Audit group — the accountability/meta surfaces, below whatever rail body
			     is active. A labelled <div role="group">: the heading shows when expanded
			     and hides under the icon-only collapse, but the group keeps its aria-label
			     so it stays a named section for AT at every width. Items carry icon +
			     title/aria tooltips so they survive the collapse. Always rendered (custom
			     rail or default nav, expanded or collapsed) so it is never unreachable. -->
			<div class="left-rail-group" role="group" aria-label={auditLabel} data-slot="left-rail-audit">
				{#if !collapsed}
					<SectionLabel text={auditLabel} variant="station" class="left-rail-group-heading" />
				{/if}
				<div class="left-rail-nav">
					{#each auditItems as item (item.key)}
						{@const Icon = auditIcons[item.key]}
						<a
							href={item.href}
							class="left-rail-link"
							title={collapsed ? item.label : undefined}
							aria-label={item.label}
							aria-current={item.active ? 'page' : undefined}
						>
							<span class="left-rail-icon" aria-hidden="true">
								<Icon size={17} strokeWidth={2.1} />
							</span>
							{#if !collapsed}
								<span class="left-rail-copy">
									<span>{item.label}</span>
								</span>
							{/if}
						</a>
					{/each}
				</div>
			</div>
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

	/* ≥xl (1280px): the rail restyles into a FLOATING PILL COLUMN of the same
	   chassis family as the NavPill — 2px --border-brand, 92% background mix,
	   blur(16px), --shadow-nav — but radius --radius-xl (a column, not a capsule).
	   It insets below the pill via --chrome-offset and floats off all three edges,
	   so the blueprint grid runs behind it. The overlay-column geometry (width /
	   --app-left-rail-offset / collapse / drag) is UNTOUCHED — only the rail's own
	   box restyles. Below xl (incl. the 1024–1279 flush band + the mobile overlay)
	   it keeps its prior edge-anchored bg-card treatment. */
	@media (min-width: 1280px) {
		.left-rail {
			height: auto;
			max-height: calc(100dvh - var(--chrome-offset) - 0.75rem);
			margin: var(--chrome-offset) 0.75rem 0.75rem 0.75rem;
			background: color-mix(in srgb, var(--background) 92%, transparent);
			border: 2px solid var(--border-brand);
			border-radius: var(--radius-xl);
			box-shadow: var(--shadow-nav);
			backdrop-filter: blur(16px) saturate(1.1);
			-webkit-backdrop-filter: blur(16px) saturate(1.1);
		}
		/* The rail head's bottom rule softens to a subtle hairline inside the floating
		   card (the hard border-b read as a seam against the rounded chassis). */
		.left-rail .left-rail-head {
			border-bottom-color: var(--border-subtle);
		}
	}

	@media (min-width: 1280px) and (prefers-reduced-motion: no-preference) {
		.left-rail {
			transition: margin var(--duration-normal) var(--ease-default);
		}
	}

	/* Reserve a stable scrollbar gutter so the rail body never shifts horizontally
	   when a vertical scrollbar appears mid-drag. */
	.left-rail-body-inner {
		scrollbar-gutter: stable;
	}

	/* Collapsed icon-only rail: drop the right-only gutter (which would push the
	   centred tiles leftward into uneven padding) so the tiles sit with EQUAL space
	   on both sides. The ScrollArea's own overlay scrollbar handles any overflow. */
	.left-rail[data-open='false'] .left-rail-body-inner {
		scrollbar-gutter: auto;
	}

	.left-rail[data-open='true'] .left-rail-head {
		gap: 0.5rem;
	}

	.left-rail[data-open='false'] .left-rail-head {
		justify-content: center;
	}

	.left-rail-nav {
		display: grid;
		gap: 0.375rem;
	}

	.left-rail[data-open='false'] .left-rail-nav {
		justify-items: center;
	}

	/* Audit group — separated from the primaries by a quiet rule + breathing room,
	   so it reads as a distinct section without shouting. The heading is a station-
	   voice SectionLabel; under the icon-only collapse it is omitted in markup, and
	   the rule tightens so the icons stay flush. */
	.left-rail-group {
		display: grid;
		gap: 0.375rem;
		margin-top: 0.875rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-subtle);
	}

	.left-rail[data-open='false'] .left-rail-group {
		justify-items: center;
		margin-top: 0.5rem;
		padding-top: 0.5rem;
	}

	:global(.left-rail-group-heading) {
		padding-inline: 0.25rem;
		padding-bottom: 0.125rem;
	}

	.left-rail-link {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.75rem;
		height: var(--left-rail-tile-size);
		min-height: var(--left-rail-tile-size);
		padding: 0.5rem 0.75rem;
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 84%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition:
			color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}

	.left-rail[data-open='false'] .left-rail-link {
		justify-content: center;
		gap: 0;
		width: var(--left-rail-tile-size);
		height: var(--left-rail-tile-size);
		min-height: var(--left-rail-tile-size);
		padding: 0.5rem;
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
		gap: 0.125rem;
		/* Ease the copy in/out on collapse-expand (the row text fading rather than
		   snapping); guarded under prefers-reduced-motion below. */
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-out);
	}

	.left-rail-copy span {
		overflow: hidden;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 700;
		line-height: 1.05;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.left-rail-copy small {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
		text-overflow: ellipsis;
		white-space: nowrap;
		/* Reflow gate: the description fades out (see the @container rule) before the
		   label, so a narrowing rail sheds the secondary line gracefully. */
		transition: opacity var(--duration-fast) var(--ease-default);
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
			padding-inline: 0.5rem;
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
