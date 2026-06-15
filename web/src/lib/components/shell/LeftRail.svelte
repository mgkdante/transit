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
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';

	interface LeftRailProps {
		/** Active locale (prop wins; falls back to context for isolated renders). */
		locale?: Locale;
		/** Optional heading shown above the rail body. */
		heading?: string;
		/** Rail body — the page fills this; empty state shows when omitted. */
		children?: Snippet;
		class?: string;
	}

	let { locale: localeProp, heading, children, class: className }: LeftRailProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const defaultHeading = $derived(locale === 'fr' ? 'Réseau' : 'Network');
	const emptyLabel = $derived(
		locale === 'fr' ? 'Aucun contenu pour le moment' : 'No content yet',
	);
	const navAria = $derived(locale === 'fr' ? 'Navigation du réseau' : 'Network navigation');
</script>

<nav
	class={cn(
		'flex h-full w-[300px] shrink-0 flex-col border-r border-border bg-card',
		className,
	)}
	aria-label={navAria}
	data-slot="left-rail"
>
	<!-- Rail header — sticky above the scrolling body. -->
	<div class="flex h-12 shrink-0 items-center border-b border-border-subtle px-4">
		<SectionLabel text={heading ?? defaultHeading} variant="station" />
	</div>

	<!-- Rail body — scrolls internally so the map stage stays put. -->
	<ScrollArea class="min-h-0 flex-1" data-slot="left-rail-body">
		<div class="p-3">
			{#if children}
				{@render children()}
			{:else}
				<p class="px-1 py-6 text-center text-caption text-muted-foreground">
					{emptyLabel}
				</p>
			{/if}
		</div>
	</ScrollArea>
</nav>
