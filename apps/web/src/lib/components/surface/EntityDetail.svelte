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
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { getLocale } from '$lib/i18n';
	import { resolveBreadcrumbTrail } from '$lib/seo/routeSeo';
	import Breadcrumb from './Breadcrumb.svelte';

	interface EntityDetailProps {
		/** Mono station-voice overline (e.g. "LIGNE", "ARRÊT"). */
		kicker: string;
		/** Surface-specific heading (SectionHeading for lines, StopLabel for stops). */
		header: Snippet;
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
		/** Optional extra classes on the surface root. */
		class?: string;
	}

	let {
		kicker,
		header,
		tabs,
		active = $bindable(),
		pane,
		back,
		class: className,
	}: EntityDetailProps = $props();

	// Visible breadcrumb on the stable detail surfaces (/route/[id], /stop/[id]).
	// Locale via context (siblings read getLocale()); the path from $app/state so
	// the trail follows client navigations. resolveBreadcrumbTrail returns [] for
	// every other surface, so the Breadcrumb (which itself guards on >1 crumb) is
	// inert elsewhere. The leaf label is the URL id segment (route #/stop code) —
	// a per-entity NAME leaf is a tracked follow-up (see routeSeo TODO(seo); needs
	// the SSR entity seed), so this matches the JSON-LD trail exactly today.
	const locale = getLocale();
	const trail = $derived(resolveBreadcrumbTrail(page.url.pathname, locale));
</script>

<Surface width="bleed" as="div" class={className} data-slot="entity-detail">
	<!-- A4 (slice-9.7): route/stop detail is a DATA DASHBOARD — it fills the
	     rail-inset <main> width edge-to-edge (width="bleed"), keeping the page
	     gutter (--space-page-x, from the surface-shell--gutter) and the "never
	     behind the left rail" boundary (AppShell's <main> padding-left, untouched).
	     The masthead (breadcrumb + back + kicker + heading) and the tabs + their
	     data panes (tables / charts / crosstabs) all share the gutter-aligned left
	     edge and span the full bleed width. EntityDetail's own template carries no
	     long-form prose paragraphs to re-cap — the honest no-data notes / caveats
	     live in the caller panes (RouteDetail / StopDetail), which own their own
	     reading measures; .surface-measure is available there if they need it. -->
	<div class="surface-head">
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
	</div>

	<Separator variant="hazard" />

	<Tabs bind:value={active}>
		<TabsList variant="line" class="w-full justify-start">
			{#each tabs as t (t.key)}
				<TabsTrigger value={t.key}>{t.label}</TabsTrigger>
			{/each}
		</TabsList>

		{#each tabs as t (t.key)}
			<TabsContent value={t.key} class="surface-pane">{@render pane(t.key)}</TabsContent>
		{/each}
	</Tabs>
</Surface>

<style>
	.surface-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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
