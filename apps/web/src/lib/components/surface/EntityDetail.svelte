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
		lede?: string;
		meta?: Snippet;
		cornerMeta?: Snippet;
		banner?: Snippet;
		tabs: readonly { key: K; label: string }[];
		active: K;
		pane: Snippet<[K]>;
		paneOwnedRailKeys?: readonly K[];
		articleToc?: {
			entries: Partial<Record<K, TocEntry[]>>;
			heading: string;
			sectionKey: string;
			counterPrefix?: string;
			openAria: string;
			closeAria: string;
		};
		back?: { href: string; label: string };
		class?: string;
	}
	type EntityDetailModeProps =
		| {
				kicker: string;
				header: Snippet;
				articleHeader?: never;
		  }
		| {
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

	const locale = getLocale();
	const trail = $derived(resolveBreadcrumbTrail(page.url.pathname, locale));
	const paneOwnsRail = $derived(paneOwnedRailKeys.includes(active));
	const articleTocEntries = $derived(articleToc?.entries[active] ?? []);
	let mountedPanes = $state<{ pathname: string; keys: K[] }>(
		untrack(() => ({ pathname: page.url.pathname, keys: [active] })),
	);
	let activeTocId = $state('');
	let tabViewport = $state<HTMLElement>();
	let tabsMoreEnd = $state(false);
	let observedTabViewport: HTMLElement | undefined;
	let previousTocIds: string[] = [];
	$effect.pre(() => {
		const pathname = page.url.pathname;
		if (mountedPanes.pathname !== pathname) {
			mountedPanes = { pathname, keys: [active] };
		} else if (!mountedPanes.keys.includes(active)) {
			mountedPanes = { pathname, keys: [...mountedPanes.keys, active] };
		}
	});
	function paneBodyMounted(key: K): boolean {
		const pathname = page.url.pathname;
		return (
			key === active || (mountedPanes.pathname === pathname && mountedPanes.keys.includes(key))
		);
	}
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

	function measureTabOverflow(viewport = tabViewport): void {
		if (!viewport) return;
		tabsMoreEnd = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1;
	}

	function centerActiveTab(viewport: HTMLElement): void {
		const activeTab = viewport.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
		const reduced =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (activeTab) {
			const desiredLeft = activeTab.offsetLeft - (viewport.clientWidth - activeTab.offsetWidth) / 2;
			const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
			const left = Math.min(Math.max(0, desiredLeft), maxLeft);
			if (typeof viewport.scrollTo === 'function') {
				viewport.scrollTo({ behavior: reduced ? 'auto' : 'smooth', left });
			} else {
				viewport.scrollLeft = left;
			}
		}
		measureTabOverflow(viewport);
	}

	function tabInteractions(node: HTMLElement) {
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

		const onFocusIn = (event: FocusEvent) => {
			const tab = event.target;
			if (
				!(tab instanceof HTMLElement) ||
				tab.getAttribute('role') !== 'tab' ||
				!tab.matches(':focus-visible')
			)
				return;
			touchStart = null;
			suppressActivation = false;
			if (typeof tab.scrollIntoView !== 'function') return;
			tab.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
			measureTabOverflow();
		};

		node.addEventListener('pointerdown', onPointerDown, { passive: true });
		node.addEventListener('pointermove', onPointerMove, { passive: true });
		node.addEventListener('scroll', onScroll, { passive: true });
		node.addEventListener('click', onClick, true);
		node.addEventListener('focusin', onFocusIn);

		return {
			destroy() {
				node.removeEventListener('pointerdown', onPointerDown);
				node.removeEventListener('pointermove', onPointerMove);
				node.removeEventListener('scroll', onScroll);
				node.removeEventListener('click', onClick, true);
				node.removeEventListener('focusin', onFocusIn);
			},
		};
	}

	$effect(() => {
		const viewport = tabViewport;
		if (!viewport) return;
		observedTabViewport = undefined;
		if (typeof ResizeObserver !== 'function') {
			observedTabViewport = viewport;
			measureTabOverflow(viewport);
			return;
		}

		let disposed = false;
		const observer = new ResizeObserver(() => {
			if (disposed) return;
			if (observedTabViewport !== viewport) {
				observedTabViewport = viewport;
				centerActiveTab(viewport);
			} else {
				measureTabOverflow(viewport);
			}
		});
		observer.observe(viewport);
		const tabList = viewport.querySelector('[role="tablist"]');
		if (tabList) observer.observe(tabList);
		return () => {
			disposed = true;
			observer.disconnect();
		};
	});

	$effect(() => {
		const selected = active;
		const viewport = tabViewport;
		let cancelled = false;
		void tick().then(() => {
			if (cancelled || !viewport || selected !== active || observedTabViewport !== viewport) return;
			centerActiveTab(viewport);
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
			use:tabInteractions
			class="entity-tabs__scroll"
			data-ripple-exempt
			data-slot="entity-detail-tabs-scroll"
		>
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
			{#if paneBodyMounted(t.key)}
				{@render pane(t.key)}
			{/if}
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
	:global(.surface-shell.entity-detail-surface) {
		position: relative;
	}
	.surface-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.surface-head--cornered {
		position: relative;
	}
	@media (min-width: 768px) {
		.surface-head--cornered {
			padding-top: 1.5rem;
			padding-bottom: 2rem;
		}
	}

	.surface-banner {
		margin-block: 0.25rem 1rem;
	}
	.surface-banner--article {
		margin: 0;
	}
	.surface-detail-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}

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
		padding-block: calc((var(--strip-h) - 3px - var(--size-tap-min)) / 2);
		padding-inline: var(--space-page-x);
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

	.station-tab {
		flex: 1 0 max-content;
		min-width: max-content;
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
