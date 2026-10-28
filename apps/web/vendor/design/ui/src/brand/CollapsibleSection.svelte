<!--
  Collapsible section card. The whole non-interactive card surface toggles it; the header stays
  the real button. Closed bodies stay mounted (inert) so server markup and anchors are complete.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface CollapsibleSectionProps {
		title: string;
		subtitle?: string;
		/** `article-summary`: a heading row with optional actions and a clamped subtitle. */
		headerVariant?: 'default' | 'article-summary';
		open?: boolean;
		/** Stores the reader's open/closed choice for the tab under this locale-free key. */
		sectionKey?: string;
		/** Zero-based; renders the 01, 02 badge. */
		index?: number | null;
		accentColor?: string;
		collapsible?: boolean;
		/** Emits `data-toc` so TocNav and TocPill can target this section. */
		anchor?: string;
		/** Follow quiet mode. Pass false when another owner already applies it. */
		quiet?: boolean;
		/** A product signal that opens the section whenever it changes, like a reader click. */
		openSignal?: number | null;
		icon?: Snippet;
		headerActions?: Snippet;
		children?: Snippet;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { Badge } from '../primitives/badge/index.js';
	import { Card } from '../primitives/card/index.js';
	import { persisted } from '../state/persisted.svelte.js';
	import { quietMode } from '../state/quiet-mode.svelte.js';
	import ChevronToggle from './ChevronToggle.svelte';

	let {
		title,
		subtitle,
		headerVariant = 'default',
		open = $bindable(true),
		sectionKey,
		index = null,
		accentColor = 'var(--primary)',
		collapsible = true,
		anchor,
		quiet = true,
		openSignal = null,
		icon,
		headerActions,
		children,
	}: CollapsibleSectionProps = $props();

	const headerUid = $props.id();
	const subtitleId = `${headerUid}-summary`;
	const contentId = `${headerUid}-content`;
	const usesArticleSummary = $derived(collapsible && headerVariant === 'article-summary');
	const hasHeaderMark = $derived(index !== null || icon !== undefined);

	// Only reader choices are stored. Quiet mode changes what a keyed section shows without
	// overwriting that choice, so Collapse all here and Expand all elsewhere leave no stale close.
	const stored = untrack(() => (sectionKey ? persisted(sectionKey, open) : null));
	let quietOverride = $state<boolean | null>(null);
	// A static card always shows its body; the stored choice waits for it to become collapsible.
	const isOpen = $derived(!collapsible || (quietOverride ?? (stored ? stored.value : open)));
	// The head boot script applies the stored choice to these marked elements before first paint.
	const persistedKey = $derived(collapsible ? sectionKey : undefined);

	function choose(next: boolean): void {
		quietOverride = null;
		if (stored) stored.value = next;
		else open = next;
	}

	function applyQuiet(next: boolean): void {
		if (!collapsible || !quiet) return;
		if (stored) quietOverride = next;
		else open = next;
	}

	untrack(() => {
		if (quietMode.enabled) applyQuiet(false);
	});

	// One effect for both counters: several toggles in one tick must land on the final mode.
	let lastQuietSignals = untrack(() => `${quietMode.closeSignal}:${quietMode.openSignal}`);
	$effect(() => {
		const signals = `${quietMode.closeSignal}:${quietMode.openSignal}`;
		if (signals === lastQuietSignals) return;
		lastQuietSignals = signals;
		applyQuiet(!untrack(() => quietMode.enabled));
	});

	let lastOpenSignal = untrack(() => openSignal);
	$effect(() => {
		const signal = openSignal;
		if (signal === lastOpenSignal) return;
		lastOpenSignal = signal;
		if (collapsible && signal !== null) choose(true);
	});

	let trigger = $state<HTMLButtonElement>();
	let content = $state<HTMLElement>();
	// A collapse that hides the focused element hands focus back to the trigger.
	$effect.pre(() => {
		if (!isOpen && content?.contains(document.activeElement)) trigger?.focus();
	});

	const triggerProps = $derived({
		type: 'button' as const,
		'data-section-trigger': '',
		'data-slot': 'collapsible-trigger',
		'data-state': isOpen ? 'open' : 'closed',
		'data-persisted-key': persistedKey,
		'aria-controls': contentId,
		'aria-expanded': isOpen,
		onclick: (event: MouseEvent) => {
			if (event.button !== 0) event.preventDefault();
			else choose(!isOpen);
		},
	});

	// Interactive children keep their own clicks, nested cards own theirs, and ending a text
	// selection is reading, not toggling.
	const INTERACTIVE_CHILD =
		'a,button,input,select,textarea,[role="button"],[data-card-interactive]';
	function onCardClick(event: MouseEvent) {
		const target = event.target as Element | null;
		if (!target) return;
		if (target.closest(INTERACTIVE_CHILD)) return;
		if (target.closest('[data-slot="card"]') !== event.currentTarget) return;
		if (window.getSelection()?.toString()) return;
		choose(!isOpen);
	}
</script>

{#snippet headerMark()}
	{#if index !== null}
		<Badge
			variant="number"
			class="text-[0.75rem]"
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
	<div
		data-slot="collapsible"
		data-state={isOpen ? 'open' : 'closed'}
		data-persisted-key={persistedKey}
	>
		{#if collapsible}
			{#if usesArticleSummary}
				<div
					class="section-heading-row"
					class:section-heading-row--actions={headerActions !== undefined}
				>
					<h2 class="section-heading">
						<button
							{...triggerProps}
							bind:this={trigger}
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
						<ChevronToggle open={isOpen} direction="right" data-persisted-key={persistedKey} />
					</span>
				</div>
				{#if subtitle}
					<p
						id={subtitleId}
						class="section-subtitle section-subtitle--article-summary {hasHeaderMark
							? 'section-subtitle--with-mark'
							: ''}"
						data-state={isOpen ? 'open' : 'closed'}
						data-persisted-key={persistedKey}
					>
						<span class="section-subtitle__text">{subtitle}</span>
					</p>
				{/if}
			{:else}
				<button
					{...triggerProps}
					bind:this={trigger}
					class="section-header flex w-full items-center gap-2.5 px-6 py-4 text-left"
				>
					{@render legacyHeaderContent()}
					<ChevronToggle open={isOpen} direction="right" data-persisted-key={persistedKey} />
				</button>
			{/if}
		{:else}
			<div class="flex items-center gap-2.5 px-6 py-4">
				{@render legacyHeaderContent()}
			</div>
		{/if}

		<div
			bind:this={content}
			id={contentId}
			class="collapsible-content section-body"
			data-slot="collapsible-content"
			data-state={isOpen ? 'open' : 'closed'}
			data-persisted-body={persistedKey}
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
	:global([data-slot='card'].section-card) {
		border-width: 3px;
	}

	:global([data-slot='card'].section-card.section-card--article-summary) {
		padding-block: 0;
	}

	:global([data-slot='card'].section-card:hover) {
		border-color: var(--accent);
	}

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
			scale 120ms cubic-bezier(0.2, 0, 0, 1),
			opacity 120ms cubic-bezier(0.2, 0, 0, 1);
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
	@media (prefers-reduced-motion: reduce) {
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
		transition: grid-template-rows var(--duration-slow) var(--ease-default);
	}

	.collapsible-content[data-state='open'] {
		grid-template-rows: 1fr;
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
