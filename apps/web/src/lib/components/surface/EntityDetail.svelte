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
	import { tick, untrack, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '@yesid/ui/tabs';
	import { SectionLabel } from '@yesid/ui/brand';
	import { DetailShell, Surface } from '$lib/components/layout';
	import { Separator } from '@yesid/ui/separator';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { getLocale } from '$lib/i18n';
	import { resolveBreadcrumbTrail } from '$lib/seo/routeSeo';
	import {
		TocNav,
		openCollapsedTocTarget,
		reconcileActiveToc,
		revealTocTarget,
		type TocEntry,
	} from '$lib/components/shared';
	import { cn } from '$lib/utils';
	import Breadcrumb from './Breadcrumb.svelte';

	interface EntityDetailSharedProps {
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
		/**
		 * Optional ALWAYS-VISIBLE banner rendered between the head and the tabs (§C5.4 /
		 * §C5.6) — the at-a-glance verdict that must never be buried behind a tab. The
		 * caller drops a fully-composed block (e.g. a VerdictBanner); omitted ⇒ no banner.
		 */
		banner?: Snippet;
		/** Tab definitions — stable key + already-localized label. */
		tabs: readonly { key: K; label: string }[];
		/** The active tab key (two-way bindable). */
		active: K;
		/** Renders the pane body for a given tab key. */
		pane: Snippet<[K]>;
		/** Pane keys whose content already owns a complete desktop/mobile rail. The
		 *  outer article tab rail becomes a toolbar so the page never nests rails. */
		paneOwnedRailKeys?: readonly K[];
		/** Article-pane section navigation. Tabs stay in the stable top toolbar;
		 * this config restores the Yesid article ToC in the wide left rail and
		 * floating mobile pill for panes that expose section anchors. */
		articleToc?: {
			entries: Partial<Record<K, TocEntry[]>>;
			heading: string;
			sectionKey: string;
			counterPrefix?: string;
			openAria: string;
			closeAria: string;
		};
		/**
		 * Optional back affordance ("← Lines") that keeps navigation inside the app
		 * chrome: a localized index href + label. Omitted ⇒ no back link.
		 */
		back?: { href: string; label: string };
		/** Optional extra classes on the surface root. */
		class?: string;
	}
	type EntityDetailModeProps =
		| {
				/** Mono station-voice overline (e.g. "LIGNE", "ARRÊT"). */
				kicker: string;
				/** Surface-specific classic heading. */
				header: Snippet;
				articleHeader?: never;
		  }
		| {
				/** Complete article cover rendered outside the padded Surface. */
				articleHeader: Snippet;
				kicker?: never;
				header?: never;
		  };
	type EntityDetailProps = EntityDetailSharedProps & EntityDetailModeProps;

	let {
		kicker,
		header,
		articleHeader,
		lede,
		meta,
		cornerMeta,
		banner,
		tabs,
		active = $bindable(),
		pane,
		paneOwnedRailKeys = [],
		articleToc,
		back,
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
	const paneOwnsRail = $derived(paneOwnedRailKeys.includes(active));
	const articleTocEntries = $derived(articleToc?.entries[active] ?? []);
	let activeTocId = $state('');
	let tabViewport = $state<HTMLElement>();
	let tabsMoreEnd = $state(false);
	let previousTocIds: string[] = [];
	$effect(() => {
		const nextIds = articleTocEntries.map((entry) => entry.id);
		const currentId = untrack(() => activeTocId);
		const nextActiveId = reconcileActiveToc(currentId, previousTocIds, nextIds);
		if (nextActiveId !== currentId) activeTocId = nextActiveId;
		previousTocIds = nextIds;
	});
	function navigateArticleToc(id: string): void {
		const reduced =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		void revealTocTarget(id, {
			beforeReveal: openCollapsedTocTarget,
			behavior: reduced ? 'auto' : 'smooth',
		});
	}

	function measureTabOverflow(): void {
		if (!tabViewport) return;
		tabsMoreEnd = tabViewport.scrollLeft + tabViewport.clientWidth < tabViewport.scrollWidth - 1;
	}

	function guardScrolledTouchActivation(node: HTMLElement) {
		let touchStart: { x: number; y: number; scrollLeft: number } | null = null;
		let suppressActivation = false;

		const onPointerDown = (event: PointerEvent) => {
			touchStart =
				event.pointerType === 'touch'
					? { x: event.clientX, y: event.clientY, scrollLeft: node.scrollLeft }
					: null;
			suppressActivation = false;
		};
		const onPointerMove = (event: PointerEvent) => {
			if (!touchStart || event.pointerType !== 'touch') return;
			const deltaX = Math.abs(event.clientX - touchStart.x);
			const deltaY = Math.abs(event.clientY - touchStart.y);
			if (deltaX > 8 && deltaX > deltaY) suppressActivation = true;
		};
		const onScroll = () => {
			measureTabOverflow();
			if (touchStart && Math.abs(node.scrollLeft - touchStart.scrollLeft) > 1) {
				suppressActivation = true;
			}
		};
		const onClick = (event: MouseEvent) => {
			const target = event.target as Element | null;
			if (!suppressActivation || !target?.closest('[role="tab"]')) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			suppressActivation = false;
			touchStart = null;
		};

		node.addEventListener('pointerdown', onPointerDown, { passive: true });
		node.addEventListener('pointermove', onPointerMove, { passive: true });
		node.addEventListener('scroll', onScroll, { passive: true });
		node.addEventListener('click', onClick, true);

		return {
			destroy() {
				node.removeEventListener('pointerdown', onPointerDown);
				node.removeEventListener('pointermove', onPointerMove);
				node.removeEventListener('scroll', onScroll);
				node.removeEventListener('click', onClick, true);
			},
		};
	}

	$effect(() => {
		const viewport = tabViewport;
		if (!viewport) return;
		measureTabOverflow();
		if (typeof ResizeObserver !== 'function') return;

		const observer = new ResizeObserver(measureTabOverflow);
		observer.observe(viewport);
		const tabList = viewport.querySelector('[role="tablist"]');
		if (tabList) observer.observe(tabList);
		return () => observer.disconnect();
	});

	$effect(() => {
		const selected = active;
		const viewport = tabViewport;
		let cancelled = false;
		void tick().then(() => {
			if (cancelled || !viewport || selected !== active) return;
			const activeTab = viewport.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
			const reduced =
				typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
			if (activeTab) {
				const desiredLeft =
					activeTab.offsetLeft - (viewport.clientWidth - activeTab.offsetWidth) / 2;
				const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
				const left = Math.min(Math.max(0, desiredLeft), maxLeft);
				if (typeof viewport.scrollTo === 'function') {
					viewport.scrollTo({ behavior: reduced ? 'auto' : 'smooth', left });
				} else {
					viewport.scrollLeft = left;
				}
			}
			measureTabOverflow();
		});

		return () => {
			cancelled = true;
		};
	});
</script>

{#snippet tabList(article: boolean)}
	<div class="entity-tabs" class:entity-tabs--article={article} data-slot="entity-detail-tabs">
		<div
			bind:this={tabViewport}
			use:guardScrolledTouchActivation
			class="entity-tabs__scroll"
			data-slot="entity-detail-tabs-scroll"
		>
			<!-- One tab list DOM serves mobile and desktop. It never moves when panes change. -->
			<TabsList variant="line" class="w-full flex-nowrap justify-start">
				{#each tabs as t (t.key)}
					<TabsTrigger value={t.key}>
						{#snippet child({ props })}
							<button {...props} class="station-tab" class:active={t.key === active}
								>{t.label}</button
							>
						{/snippet}
					</TabsTrigger>
				{/each}
			</TabsList>
		</div>
		<span
			class="entity-tabs__fade"
			class:entity-tabs__fade--visible={tabsMoreEnd}
			data-slot="entity-detail-tabs-fade"
			aria-hidden="true"
		></span>
	</div>
{/snippet}

{#snippet tabPanes()}
	{#each tabs as t (t.key)}
		<TabsContent value={t.key} class={cn('surface-pane', articleHeader && 'surface-pane--article')}>
			{@render pane(t.key)}
		</TabsContent>
	{/each}
{/snippet}

{#snippet articleToolbar()}
	{@render tabList(true)}
{/snippet}

{#snippet articleRail()}
	{#if articleToc}
		{#key articleToc.sectionKey}
			<TocNav
				entries={articleTocEntries}
				activeId={activeTocId}
				onNavigate={navigateArticleToc}
				heading={articleToc.heading}
				sectionKey={articleToc.sectionKey}
				counterPrefix={articleToc.counterPrefix}
			/>
		{/key}
	{/if}
{/snippet}

{#snippet articleCenter()}
	{@render tabPanes()}
{/snippet}

{#snippet articleSummary()}
	{#if banner}
		<div class="surface-banner surface-banner--article" data-slot="entity-detail-banner">
			{@render banner()}
		</div>
	{/if}
{/snippet}

<Tabs bind:value={active}>
	{#if articleHeader}
		<DetailShell
			{articleHeader}
			toolbar={articleToolbar}
			summary={paneOwnsRail || !banner ? undefined : articleSummary}
			left={articleTocEntries.length > 0 ? articleRail : undefined}
			paneOwnedRail={paneOwnsRail}
			center={articleCenter}
			tocEntries={articleTocEntries}
			bind:activeId={activeTocId}
			onNavigate={articleToc ? navigateArticleToc : undefined}
			tocOpenAria={articleToc?.openAria}
			tocCloseAria={articleToc?.closeAria}
			class={cn('entity-detail-article', className)}
		/>
	{:else}
		<Surface as="div" class={cn('entity-detail-surface', className)} data-slot="entity-detail">
			{#if header && kicker}
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
			{/if}

			{#if banner}
				<div class="surface-banner" data-slot="entity-detail-banner">{@render banner()}</div>
			{/if}

			{@render tabList(false)}
			{@render tabPanes()}
		</Surface>
	{/if}
</Tabs>

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

	/* Detail-head rhythm: the framing
	   sentence under the display title — muted, subheading-scale, ~52ch measure,
	   matching the Masthead lede so line/stop/trip heads read identically. */
	.surface-detail-lede {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: 52ch;
	}
	/* Always-visible verdict banner (§C5.4/§C5.6) between the head and the tabs —
	   quiet spacing so the VerdictBanner reads as its own register above the tab strip. */
	.surface-banner {
		margin-block: 0.25rem 1rem;
	}
	.surface-banner--article {
		margin: 0;
	}
	/* Meta row — the mono-micro chips (the stop's ARRÊT plate, the map drilldown)
	   below the lede; a flex row that wraps on narrow viewports. */
	.surface-detail-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}

	/* One normal-flow primary strip directly under the article hazard separator. */
	.entity-tabs {
		position: relative;
		--entity-tabs-max-width: 46rem;
		width: 100%;
		min-width: 0;
		background: var(--primary);
	}
	.entity-tabs__scroll {
		width: min(100%, var(--entity-tabs-max-width));
		margin-inline: auto;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-inline: contain;
		touch-action: pan-x pan-y;
		scrollbar-width: none;
	}
	.entity-tabs__scroll::-webkit-scrollbar {
		display: none;
	}
	.entity-tabs :global([role='tablist']) {
		width: 100%;
		min-width: max-content;
		padding: 0.5rem var(--space-page-x);
	}
	.entity-tabs__fade {
		position: absolute;
		z-index: 1;
		inset-block: 0;
		inset-inline-end: 0;
		width: clamp(2rem, 8vw, 5rem);
		background: linear-gradient(to right, transparent, var(--primary));
		pointer-events: none;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out);
	}
	.entity-tabs__fade--visible {
		opacity: 1;
	}

	/* Signage-active tab (yesid StationTabs parity). The child <button> replaces the
	   bare line-variant trigger: a quiet mono tab that, when active, becomes a
	   theme-invariant metro-signage chip (--signage-bg/--signage-text — the same
	   amber-on-dark sign in both themes; real signs don't reskin when the lights
	   change). The active VISUAL only — behavior/ARIA stay on the bits-ui trigger. */
	.station-tab {
		flex: 1 0 max-content;
		min-width: max-content;
		/* Tap-target floor (P5.3d §C4 P10): the tab was 41px tall → 44px. */
		min-height: var(--size-tap-min);
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		padding: 0.5rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--primary-foreground);
		background: transparent;
		border: none;
		border-bottom: 3px solid transparent;
		transition:
			color var(--duration-fast) var(--ease-out),
			background var(--duration-fast) var(--ease-out);
	}
	.station-tab:hover {
		color: var(--primary-foreground);
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
		gap: 0.375rem;
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
	:global(.surface-pane--article) {
		padding-top: 0;
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
