<!--
  Reusable collapsible section card. Used by detail pages (e.g. /metrics) and the
  shared TOC (TocNav wraps one). Card surface + numbered/icon badge + a bits-ui
  Collapsible for a11y (aria-controls, aria-expanded, focus management).

  Ported from yesid.dev shared/CollapsibleSection. Deviations from the source:
    - Transit keeps the page-scoped signal wiring explicit: this card accepts
      OPTIONAL `closeSignal` / `openSignal` monotonic counters as props. Article
      pages forward the shared store counters behind the exact `Collapse all` /
      `Expand all` actions. When a caller bumps `closeSignal`, the card collapses;
      when it bumps `openSignal`, the card opens. Absent (the default, `null`) →
      the card is signal-inert, exactly as before.
    - `persisted` is transit's sessionStorage-backed rune ($lib/stores), not
      yesid's locale-handoff one. Same `.value` surface.
-->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import {
		Collapsible,
		CollapsibleTrigger,
		CollapsibleContent,
	} from '$lib/components/ui/collapsible';
	import { ChevronToggle } from '$lib/components/brand';
	import { Badge } from '$lib/components/ui/badge';
	import { Card } from '$lib/components/ui/card';
	import { persisted } from '$lib/stores';

	type CollapsibleSectionHeaderVariant = 'default' | 'article-summary';

	let {
		title,
		subtitle = undefined,
		headerVariant = 'default',
		open = $bindable(true),
		sectionKey = undefined,
		index = null,
		accentColor = 'var(--primary)',
		collapsible = true,
		anchor = undefined,
		closeSignal = null,
		openSignal = null,
		bulkCollapsed = null,
		icon,
		children,
	}: {
		title: string;
		/**
		 * Optional one-line subtitle shown UNDER the title in the header — visible
		 * whether the card is open or closed. On /metrics this carries the metric's
		 * `oneLiner`, so the story is legible pre-expand (§C5.8). Muted caption voice.
		 */
		subtitle?: string;
		headerVariant?: CollapsibleSectionHeaderVariant;
		open?: boolean;
		/**
		 * Opt this section's open/closed state into surviving a locale navigation.
		 * When set, a sessionStorage value keyed by `sectionKey` (a stable,
		 * locale-free string, NOT the translated title) drives `open`, seeded with
		 * the `open` prop as the per-slot default. When absent, the plain
		 * `$bindable` `open` is the source of truth.
		 */
		sectionKey?: string;
		index?: number | null;
		accentColor?: string;
		collapsible?: boolean;
		/** When set, renders `data-toc={anchor}` on the card root so the shared TOC
		 *  (TocNav / TocPill via toc.ts) can scroll to + active-track this section. */
		anchor?: string;
		/**
		 * Monotonic "collapse this card" signal. Each time the page-scoped
		 * `Collapse all` action bumps it to a new number, the card collapses. `null`
		 * (default) keeps the card signal-inert.
		 */
		closeSignal?: number | null;
		/**
		 * Monotonic "open this card" signal. Each time the page-scoped `Expand all`
		 * action bumps it, the card opens. `null` (default) keeps it signal-inert.
		 */
		openSignal?: number | null;
		/**
		 * The page's CURRENT bulk mode (quietModeStore.enabled) for cards that mount
		 * AFTER the article's mount-time signal fired (data-gated cards appear once
		 * their fetch resolves; the edge-detectors can't see a bump that predates
		 * init). Applied once at init, authoritative over the `open` default and any
		 * restored session choice — the same contract the mount-time signal enforces
		 * for cards that were present when it fired. `null` (default) keeps the
		 * mount state seed-driven, exactly as before.
		 */
		bulkCollapsed?: boolean | null;
		icon?: Snippet;
		children?: Snippet;
	} = $props();

	const headerUid = $props.id();
	const subtitleId = `${headerUid}-summary`;
	const usesArticleSummary = $derived(
		collapsible && headerVariant === 'article-summary',
	);
	const hasHeaderMark = $derived(index !== null || icon !== undefined);

	// When a sectionKey is supplied, the open state is session-scoped: persisted()
	// seeds from the `open` prop default. The key + seed are captured ONCE at init
	// (untrack makes that explicit - like every persisted() call site, the key
	// must be a stable string), so a later prop change never re-creates the store.
	// When no key is supplied, `persistedOpen` is null and the bindable `open` is
	// the source of truth (the existing behaviour).
	const persistedOpen = untrack(() => (sectionKey ? persisted(sectionKey, open) : null));

	// Single source of truth the template binds to: the persisted value when
	// keyed, otherwise the local bindable. Writes route back to whichever owns it.
	let isOpen = $derived(persistedOpen ? persistedOpen.value : open);
	function setOpen(next: boolean): void {
		if (persistedOpen) persistedOpen.value = next;
		else open = next;
	}

	// Article-control parity — edge-triggered collapse/open signals (yesid
	// closeSignal/openSignal idiom). Each effect fires only when its counter CHANGES from the
	// value captured at init, so the initial render never force-toggles (SSR-safe,
	// respects a restored persisted state). A `null` signal is inert: the last-seen
	// value stays null and the guard never advances. Only collapsible cards react.
	// The init reads are `untrack`ed on purpose: they seed the edge-detector once
	// (capturing the initial prop), and it is the $effect that reactively tracks it.
	let lastCloseSignal = untrack(() => closeSignal);
	$effect(() => {
		const signal = closeSignal;
		if (signal === lastCloseSignal) return;
		lastCloseSignal = signal;
		if (collapsible && signal !== null) setOpen(false);
	});

	let lastOpenSignal = untrack(() => openSignal);
	$effect(() => {
		const signal = openSignal;
		if (signal === lastOpenSignal) return;
		lastOpenSignal = signal;
		if (collapsible && signal !== null) setOpen(true);
	});

	// Mount-time bulk adoption: a card mounting after the article's mount-time
	// signal fired would otherwise keep its seed (stale session choice or the
	// `open` default) and desync from the page's bulk mode. Cards mounted BEFORE
	// the signal are unaffected: init() re-emits on every article mount and the
	// edge effects above settle them to the same state.
	untrack(() => {
		if (collapsible && bulkCollapsed !== null) setOpen(!bulkCollapsed);
	});

	// The WHOLE card is the toggle surface. Interactive children take priority: a
	// click that originates inside a link/button/input never toggles. The header
	// button matches 'button' here too, which is exactly right: its own bits-ui
	// trigger already toggles, so skipping it prevents a double-toggle. The header
	// stays the semantic button (aria-expanded, keyboard); this handler is a
	// pointer convenience on top.
	const INTERACTIVE_CHILD = 'a,button,input,select,textarea,[role="button"]';
	function onCardClick(event: MouseEvent) {
		const target = event.target as Element | null;
		if (!target) return;
		if (target.closest(INTERACTIVE_CHILD)) return;
		// A nested card owns its own clicks; never toggle an ancestor card.
		if (target.closest('[data-slot="card"]') !== event.currentTarget) return;
		// A click that ends a text selection is content interaction, not a toggle.
		if (window.getSelection()?.toString()) return;
		setOpen(!isOpen);
	}
</script>

{#snippet headerMark()}
	{#if index !== null}
		<Badge
			variant="number"
			aria-hidden="true"
			style={accentColor ? `background-color: ${accentColor}` : ''}
			>{String(index + 1).padStart(2, '0')}</Badge
		>
	{:else if icon}
		{@render icon()}
	{/if}
{/snippet}

{#snippet legacyHeaderContent()}
	{@render headerMark()}
	<span class="section-title-group flex flex-1 flex-col gap-0.5">
		<h2 class="section-title font-heading text-lg font-bold text-[var(--foreground)]">
			{title}
		</h2>
		{#if subtitle}
			<!-- One-line story, visible whether the card is open or closed (§C5.8). -->
			<span class="section-subtitle">{subtitle}</span>
		{/if}
	</span>
{/snippet}

<!--
  --accent CSS custom property propagates accentColor into the style block.
  Collapsible.Root renders the div we use as the card wrapper.
-->
<Card
	class="section-card {collapsible ? 'section-card--toggleable' : ''} {usesArticleSummary
		? 'section-card--article-summary'
		: ''}"
	style="--accent: {accentColor};"
	data-toc={anchor}
	data-header-variant={usesArticleSummary ? 'article-summary' : undefined}
	onclick={collapsible ? onCardClick : undefined}
>
	<Collapsible bind:open={() => isOpen, setOpen}>
		{#if collapsible}
			{#if usesArticleSummary}
				<h2 class="section-heading">
					<CollapsibleTrigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								aria-describedby={subtitle ? subtitleId : undefined}
								class="section-header section-header--article-summary {hasHeaderMark
									? 'section-header--with-mark'
									: ''} {subtitle ? '' : 'section-header--title-only'}"
							>
								{#if hasHeaderMark}
									<span class="section-header__mark" aria-hidden="true">
										{@render headerMark()}
									</span>
								{/if}
								<span
									class="section-title section-title--article-summary font-heading text-lg font-bold text-[var(--foreground)]"
								>
									{title}
								</span>
								<ChevronToggle open={isOpen} direction="right" />
							</button>
						{/snippet}
					</CollapsibleTrigger>
				</h2>
				{#if subtitle}
					<p
						id={subtitleId}
						class="section-subtitle section-subtitle--article-summary {hasHeaderMark
							? 'section-subtitle--with-mark'
							: ''}"
						data-state={isOpen ? 'open' : 'closed'}
					>
						<span class="section-subtitle__text">{subtitle}</span>
					</p>
				{/if}
			{:else}
				<CollapsibleTrigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="section-header flex w-full items-center gap-2.5 px-6 py-4 text-left"
						>
							{@render legacyHeaderContent()}
							<ChevronToggle open={isOpen} direction="right" />
						</button>
					{/snippet}
				</CollapsibleTrigger>
			{/if}
		{:else}
			<div class="flex items-center gap-2.5 px-6 py-4">
				{@render legacyHeaderContent()}
			</div>
		{/if}

		<CollapsibleContent class="section-body">
			<div class="px-6 pb-6 pt-3">
				{#if children}
					{@render children()}
				{/if}
			</div>
		</CollapsibleContent>
	</Collapsible>
</Card>

<style>
	/* The section-card frame steps up to a 3px rule so content blocks read as
	   discrete panels (matches the detail-page card progression). */
	:global([data-slot='card'].section-card) {
		border-width: 3px;
	}

	:global([data-slot='card'].section-card.section-card--article-summary) {
		padding-block: 0;
	}

	:global([data-slot='card'].section-card:hover) {
		border-color: var(--accent);
	}

	/* The whole card is the toggle surface: pointer affordance + a tap-press tier
	   (scale .97 / opacity .92) on the NON-INTERACTIVE surface only. Presses that
	   start on interactive children (links/buttons/inputs, incl. the header
	   button) keep their own feedback and don't press the shell. The extra
	   .section-card qualifier outranks card.svelte's scoped transition. */
	.section-header {
		cursor: pointer;
	}

	.section-heading {
		margin: 0;
	}

	.section-header--article-summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 1.25rem;
		align-items: start;
		column-gap: .625rem;
		min-height: 44px;
		padding: 1rem 1.5rem .375rem;
		text-align: left;
	}

	.section-header--article-summary.section-header--with-mark {
		grid-template-columns: 1.75rem minmax(0, 1fr) 1.25rem;
	}

	.section-header--article-summary.section-header--title-only {
		padding-block: 1rem;
	}

	.section-header__mark {
		display: inline-flex;
		width: 1.75rem;
		min-height: 1.75rem;
		align-items: center;
		justify-content: center;
	}

	.section-header--article-summary :global([data-slot='chevron-toggle']) {
		margin-block-start: .25rem;
	}

	.section-title--article-summary {
		min-width: 0;
		line-height: 1.4;
		text-wrap: balance;
	}

	:global([data-slot='card'].section-card.section-card--toggleable) {
		cursor: pointer;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default),
			scale var(--duration-instant) var(--ease-out),
			opacity var(--duration-instant) var(--ease-out);
	}
	:global(
		[data-slot='card'].section-card.section-card--toggleable:active:not(
				:has(
					a:active,
					button:active,
					input:active,
					select:active,
					textarea:active,
					[role='button']:active
				)
			)
	) {
		scale: 0.97;
		opacity: 0.92;
	}
	/* tap-press contract: reduced motion drops the timing, keeps the :active
	   state change (colour transitions stay, SAFE-ALWAYS). */
	@media (prefers-reduced-motion: reduce) {
		.section-header {
			cursor: pointer;
		}

		:global([data-slot='card'].section-card.section-card--toggleable) {
			transition:
				border-color var(--duration-normal) var(--ease-default),
				box-shadow var(--duration-normal) var(--ease-default);
		}
	}

	:global([data-slot='card'].section-card:hover .section-title) {
		color: var(--accent-text);
	}

	:global(.section-title) {
		transition: color var(--duration-normal) var(--ease-default);
	}

	/* One-line story subtitle — a muted caption under the title, visible whether the
	   card is open or closed (§C5.8 /metrics oneLiner). Not a data mark, not --primary. */
	.section-subtitle {
		font-size: var(--text-caption);
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	.section-subtitle--article-summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 1.25rem;
		margin: 0;
		padding: 0 1.5rem 1rem;
		color: var(--foreground);
		font-family: var(--font-body);
		font-size: var(--text-small);
		line-height: 1.6;
	}

	.section-subtitle--article-summary.section-subtitle--with-mark {
		grid-template-columns: 1.75rem minmax(0, 1fr) 1.25rem;
	}

	.section-subtitle__text {
		grid-column: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		text-wrap: pretty;
	}

	.section-subtitle--with-mark .section-subtitle__text {
		grid-column: 2;
	}

	.section-subtitle--article-summary[data-state='closed'] .section-subtitle__text {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	/* The open/close animation (grid-template-rows 0fr -> 1fr + opacity, reduced-
	   motion-guarded) lives in transit's CollapsibleContent wrapper. We only need
	   the `.section-body` hook here for the TOC/test contract; no grid rules so
	   the two never fight over the same element. */
</style>
