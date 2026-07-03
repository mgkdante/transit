<!--
  EntityDetail — the tabbed detail scaffold for an entity surface.

  Extracts the shared shell the route/[id] + stop/[id] pages hand-rolled today
  (a station-voice kicker + caller header, then a line-variant TabsList over
  TabsContent panes). Callers pass the tab definitions, the active key (bindable)
  and a `pane` snippet keyed by tab; the header snippet renders the SectionHeading
  (line) or StopLabel (stop) — surface-specific, so the caller owns it.

  Tokens, no hex. Matches the `.surface` / `.surface-head` / `.surface-pane`
  styles the two shells share.
-->
<script lang="ts" generics="K extends string">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { Surface, VerticalSectionTitle } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { getLocale } from '$lib/i18n';
	import { resolveBreadcrumbTrail } from '$lib/seo/routeSeo';
	import { cn } from '$lib/utils';
	import Breadcrumb from './Breadcrumb.svelte';

	interface EntityDetailProps {
		/** Mono station-voice overline (e.g. "LIGNE", "ARRÊT"). */
		kicker: string;
		/** Surface-specific heading (SectionHeading for lines, StopLabel for stops). */
		header: Snippet;
		/**
		 * Optional lede paragraph under the heading (muted, ~52ch) — the framing
		 * sentence in the detail-head rhythm (kicker → display title → lede → meta).
		 * Omitted ⇒ no lede row (P5.3b detail-head rhythm, §C2/§C5.4/§C5.6).
		 */
		lede?: string;
		/**
		 * Optional mono meta row under the lede — the detail-head meta chips
		 * (e.g. the stop's ARRÊT plate, the line's map action). Omitted ⇒ no meta row.
		 */
		meta?: Snippet;
		/**
		 * Optional CornerMeta block (A4) — blueprint-margin corner readouts pinned to
		 * the (relative) detail head. The caller drops a fully-composed <CornerMeta>
		 * here (REAL data only); omitted ⇒ no corner annotations. Hero-zone only.
		 */
		cornerMeta?: Snippet;
		/** Tab definitions — stable key + already-localized label. */
		tabs: readonly { key: K; label: string }[];
		/** The active tab key (two-way bindable). */
		active: K;
		/** Renders the pane body for a given tab key. */
		pane: Snippet<[K]>;
		/**
		 * Optional back affordance ("← Lines") that keeps navigation inside the app
		 * chrome: a localized index href + label. Omitted ⇒ no back link.
		 */
		back?: { href: string; label: string };
		/**
		 * Optional D2 rotated edge word in the left gutter (≥xl, decorative). Set to
		 * the already-localized word (e.g. "Reliability" / "Fiabilité") on the
		 * surfaces the design language calls for it (/lines/[id]); omitted elsewhere.
		 */
		edgeWord?: string;
		/** Optional extra classes on the surface root. */
		class?: string;
	}

	let {
		kicker,
		header,
		lede,
		meta,
		cornerMeta,
		tabs,
		active = $bindable(),
		pane,
		back,
		edgeWord,
		class: className,
	}: EntityDetailProps = $props();

	// Visible breadcrumb on the stable detail surfaces (/lines/[id], /stop/[id]).
	// Locale via context (siblings read getLocale()); the path from $app/state so
	// the trail follows client navigations. resolveBreadcrumbTrail returns [] for
	// every other surface, so the Breadcrumb (which itself guards on >1 crumb) is
	// inert elsewhere. The leaf label is the URL id segment (route #/stop code) —
	// a per-entity NAME leaf is a tracked follow-up (see routeSeo TODO(seo); needs
	// the SSR entity seed), so this matches the JSON-LD trail exactly today.
	const locale = getLocale();
	const trail = $derived(resolveBreadcrumbTrail(page.url.pathname, locale));
</script>

<Surface as="div" class={cn('entity-detail-surface', className)} data-slot="entity-detail">
	{#if edgeWord}
		<!-- D2: the rotated edge word in the left gutter (≥xl, decorative). -->
		<VerticalSectionTitle word={edgeWord} />
	{/if}
	<!-- A4 (slice-9.7): route/stop detail is a DATA DASHBOARD — it fills the
	     rail-inset <main> width edge-to-edge (Surface is full-bleed by default
	     after A1), keeping the page gutter (--space-page-x, from the
	     surface-shell--gutter) and the "never
	     behind the left rail" boundary (AppShell's <main> padding-left, untouched).
	     The masthead (breadcrumb + back + kicker + heading) and the tabs + their
	     data panes (tables / charts / crosstabs) all share the gutter-aligned left
	     edge and span the full bleed width. EntityDetail's own template carries no
	     long-form prose paragraphs to re-cap — the honest no-data notes / caveats
	     live in the caller panes (RouteDetail / StopDetail), which own their own
	     reading measures; .surface-measure is available there if they need it. -->
	<div class="surface-head" class:surface-head--cornered={cornerMeta}>
		{#if cornerMeta}
			{@render cornerMeta()}
		{/if}
		{#if trail.length > 1}
			<Breadcrumb {trail} {locale} />
		{/if}
		{#if back}
			<a class="surface-back" href={back.href}>
				<ChevronLeftIcon size={14} strokeWidth={2.4} aria-hidden="true" />
				{back.label}
			</a>
		{/if}
		<SectionLabel text={kicker} variant="station" />
		{@render header()}
		{#if lede}
			<p class="surface-detail-lede">{lede}</p>
		{/if}
		{#if meta}
			<div class="surface-detail-meta">{@render meta()}</div>
		{/if}
	</div>

	<Separator variant="hazard" />

	<Tabs bind:value={active}>
		<TabsList variant="line" class="w-full justify-start">
			{#each tabs as t (t.key)}
				<!-- Signage-active tab look (the yesid StationTabs pattern): bits-ui owns
				     behavior / ARIA / roving-tabindex via {...props}; the child <button> owns
				     the markup + the theme-invariant metro-signage active chip (--signage-*),
				     replacing the bare underline. -->
				<TabsTrigger value={t.key}>
					{#snippet child({ props })}
						<button {...props} class="station-tab" class:active={t.key === active}>{t.label}</button
						>
					{/snippet}
				</TabsTrigger>
			{/each}
		</TabsList>

		{#each tabs as t (t.key)}
			<TabsContent value={t.key} class="surface-pane">{@render pane(t.key)}</TabsContent>
		{/each}
	</Tabs>
</Surface>

<style>
	/* Anchor for the optional D2 rotated edge word's zero-width absolute rail. */
	:global(.surface-shell.entity-detail-surface) {
		position: relative;
	}
	.surface-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* A4: when the head carries CornerMeta it becomes the relative host for the
	   four corner readouts; a top AND bottom margin band (only where the corners
	   surface, >=768px) keeps them clear of the content flow — the top band clears
	   the breadcrumb/kicker/heading, the bottom band clears the meta row (the map
	   drilldown / ARRÊT plate) that the bottom corners would otherwise overlap. */
	.surface-head--cornered {
		position: relative;
	}
	@media (min-width: 768px) {
		.surface-head--cornered {
			padding-top: 1.5rem;
			/* The bottom band must exceed the corner's own footprint (its 0.75rem
			   inset + its ~0.9rem line-box) so the bottom corner clears the meta row
			   entirely rather than grazing its baseline. */
			padding-bottom: 2rem;
		}
	}

	/* Detail-head rhythm (§C2/§C5.4/§C5.6, yesid-visual-spec §6): the framing
	   sentence under the display title — muted, subheading-scale, ~52ch measure,
	   matching SurfaceHeader's lede so line/stop/trip heads read identically. */
	.surface-detail-lede {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: 52ch;
	}
	/* Meta row — the mono-micro chips (the stop's ARRÊT plate, the map drilldown)
	   below the lede; a flex row that wraps on narrow viewports. */
	.surface-detail-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}

	/* Signage-active tab (yesid StationTabs parity). The child <button> replaces the
	   bare line-variant trigger: a quiet mono tab that, when active, becomes a
	   theme-invariant metro-signage chip (--signage-bg/--signage-text — the same
	   amber-on-dark sign in both themes; real signs don't reskin when the lights
	   change). The active VISUAL only — behavior/ARIA stay on the bits-ui trigger. */
	.station-tab {
		min-width: max-content;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		padding: 0.5rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		border-bottom: 3px solid transparent;
		transition:
			color var(--duration-fast) var(--ease-out),
			background var(--duration-fast) var(--ease-out);
	}
	.station-tab:hover {
		color: var(--foreground);
	}
	.station-tab.active {
		background: var(--signage-bg);
		color: var(--signage-text);
		border-bottom-color: var(--signage-text);
		font-weight: 700;
	}
	.station-tab:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
		border-radius: var(--radius-sm);
	}
	@media (prefers-reduced-motion: reduce) {
		.station-tab {
			transition: none;
		}
	}

	/* Back affordance — a mono, muted link above the kicker; the chevron nudges
	   left on hover. INTERACTIVE, so --primary is doctrine-clean on hover. */
	.surface-back {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		align-self: start;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
		text-decoration: none;
		transition: color var(--duration-fast) var(--ease-out);
	}
	.surface-back:hover {
		color: var(--primary);
	}
	.surface-back:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}
	.surface-back :global(svg) {
		transition: transform var(--duration-fast) var(--ease-out);
	}
	.surface-back:hover :global(svg) {
		transform: translateX(-2px);
	}
	:global(.surface-pane) {
		padding-top: 1.25rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.surface-back,
		.surface-back :global(svg) {
			transition: none;
		}
		.surface-back:hover :global(svg) {
			transform: none;
		}
	}
</style>
