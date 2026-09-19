<!-- Persistent disclosure state, article signals and whole-card pointer behavior.
     The native button supplies keyboard activation; the body stays mounted so
     charts and reader state survive closing. CSS owns height transitions. -->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { ChevronToggle } from '@yesid/ui/brand';
	import { Badge } from '@yesid/ui/badge';
	import { Card } from '@yesid/ui/card';
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
		headerActions,
		children,
	}: {
		title: string;
		/** Visible with the card open or closed. */
		subtitle?: string;
		headerVariant?: CollapsibleSectionHeaderVariant;
		open?: boolean;
		/** Stable, locale-free sessionStorage key; when set, persisted state owns open. */
		sectionKey?: string;
		index?: number | null;
		accentColor?: string;
		collapsible?: boolean;
		/** Shared ToC target emitted as data-toc on the card root. */
		anchor?: string;
		/** A changed counter closes the card; null is inert. */
		closeSignal?: number | null;
		/** A changed counter opens the card; null is inert. */
		openSignal?: number | null;
		/** Current bulk mode for late-mounted cards. Applied once, overriding the
		 *  initial/session value; null leaves that value intact. */
		bulkCollapsed?: boolean | null;
		icon?: Snippet;
		/** Interactive actions rendered beside an article-summary disclosure button.
		 *  Kept outside the button so popovers and links remain valid, independent controls. */
		headerActions?: Snippet;
		children?: Snippet;
	} = $props();

	const headerUid = $props.id();
	const subtitleId = `${headerUid}-summary`;
	const contentId = `${headerUid}-content`;
	const usesArticleSummary = $derived(collapsible && headerVariant === 'article-summary');
	const hasHeaderMark = $derived(index !== null || icon !== undefined);

	// Capture the key and seed once; later prop updates must not recreate storage.
	const persistedOpen = untrack(() => (sectionKey ? persisted(sectionKey, open) : null));

	let isOpen = $derived(persistedOpen ? persistedOpen.value : open);
	function setOpen(next: boolean): void {
		if (persistedOpen) persistedOpen.value = next;
		else open = next;
	}

	const triggerProps = $derived({
		type: 'button' as const,
		'data-section-trigger': '',
		'data-slot': 'collapsible-trigger',
		'data-state': isOpen ? 'open' : 'closed',
		'aria-controls': contentId,
		'aria-expanded': isOpen,
		onclick: (event: MouseEvent) => {
			if (event.button !== 0) event.preventDefault();
			else setOpen(!isOpen);
		},
	});

	// Initial counters must not override restored state. Only later changes signal.
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

	// A late-mounted card cannot observe earlier signal changes; adopt bulk mode once.
	untrack(() => {
		if (collapsible && bulkCollapsed !== null) setOpen(!bulkCollapsed);
	});

	// The header already toggles itself; interactive descendants retain their own action.
	const INTERACTIVE_CHILD =
		'a,button,input,select,textarea,[role="button"],[data-card-interactive]';
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
			<span class="section-subtitle">{subtitle}</span>
		{/if}
	</span>
{/snippet}

<Card
	class="section-card {collapsible ? 'section-card--toggleable' : ''} {usesArticleSummary
		? 'section-card--article-summary'
		: ''}"
	style="--accent: {accentColor};"
	data-toc={anchor}
	data-header-variant={usesArticleSummary ? 'article-summary' : undefined}
	onclick={collapsible ? onCardClick : undefined}
>
	<div data-slot="collapsible" data-state={isOpen ? 'open' : 'closed'}>
		{#if collapsible}
			{#if usesArticleSummary}
				<div
					class="section-heading-row"
					class:section-heading-row--actions={headerActions !== undefined}
				>
					<h2 class="section-heading">
						<button
							{...triggerProps}
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
						</button>
					</h2>
					{#if headerActions}
						<div class="section-header-actions" data-card-interactive>
							{@render headerActions()}
						</div>
					{/if}
					<span class="section-header__chevron" aria-hidden="true">
						<ChevronToggle open={isOpen} direction="right" />
					</span>
				</div>
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
				<button
					{...triggerProps}
					class="section-header flex w-full items-center gap-2.5 px-6 py-4 text-left"
				>
					{@render legacyHeaderContent()}
					<ChevronToggle open={isOpen} direction="right" />
				</button>
			{/if}
		{:else}
			<div class="flex items-center gap-2.5 px-6 py-4">
				{@render legacyHeaderContent()}
			</div>
		{/if}

		<div
			id={contentId}
			class="collapsible-content section-body"
			data-slot="collapsible-content"
			data-state={isOpen ? 'open' : 'closed'}
			inert={!isOpen}
			aria-hidden={isOpen ? undefined : 'true'}
		>
			<div class="collapsible-content__inner">
				<div class="px-6 pb-6 pt-3">
					{@render children?.()}
				</div>
			</div>
		</div>
	</div>
</Card>

<style>
	/* Keep the stronger article-card rule above the shared Card defaults. */
	:global([data-slot='card'].section-card) {
		border-width: 3px;
	}

	:global([data-slot='card'].section-card.section-card--article-summary) {
		padding-block: 0;
	}

	:global([data-slot='card'].section-card:hover) {
		border-color: var(--accent);
	}

	/* Interactive descendants keep their own feedback; only the card surface scales. */
	.section-header {
		cursor: pointer;
	}

	.section-heading {
		margin: 0;
		min-width: 0;
	}

	.section-heading-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 1.25rem;
		align-items: center;
		column-gap: 0.625rem;
		padding-inline-end: 1.5rem;
	}

	.section-heading-row--actions {
		grid-template-columns: minmax(0, 1fr) auto 1.25rem;
	}

	.section-header-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 44px;
		padding: 0.875rem 0 0.5rem;
	}

	.section-header--article-summary {
		display: grid;
		width: 100%;
		grid-template-columns: minmax(0, 1fr);
		align-items: center;
		column-gap: 0.625rem;
		min-height: 44px;
		padding: 1rem 0 0.375rem 1.5rem;
		text-align: left;
	}

	.section-header--article-summary.section-header--with-mark {
		grid-template-columns: 1.75rem minmax(0, 1fr);
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

	.section-header__chevron {
		display: inline-flex;
		width: 1.25rem;
		align-items: center;
		justify-content: center;
		align-self: center;
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
					[role='button']:active,
					[data-card-interactive]:active
				)
			)
	) {
		scale: 0.97;
		opacity: 0.92;
	}
	/* Reduced motion retains color feedback without the card scale transition. */
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

	/* The summary remains visible while the body is closed. */
	.section-subtitle {
		font-size: var(--text-caption);
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	.section-subtitle--article-summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 1.25rem;
		column-gap: 0.625rem;
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

	.collapsible-content {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows var(--duration-slow) var(--ease-default),
			opacity var(--duration-slow) var(--ease-default);
	}

	.collapsible-content[data-state='open'] {
		grid-template-rows: 1fr;
		opacity: 1;
	}

	.collapsible-content__inner {
		min-height: 0;
		overflow: hidden;
	}

	@media (prefers-reduced-motion: reduce) {
		.collapsible-content {
			transition: none;
		}
	}
</style>
