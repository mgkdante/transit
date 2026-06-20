<!--
  Reusable collapsible section card. Used by detail pages (e.g. /metrics) and the
  shared TOC (TocNav wraps one). Card surface + numbered/icon badge + a bits-ui
  Collapsible for a11y (aria-controls, aria-expanded, focus management).

  Ported from yesid.dev shared/CollapsibleSection. Deviations from the source:
    - yesid's quiet-mode (a page-wide collapse-all signal) is DROPPED: transit
      has no quiet-mode store. The collapse-all was explicitly optional. Every
      other behaviour is preserved: persisted open-state, bits-ui a11y, the
      grid-rows open/close animation, the whole-card toggle, and the data-toc
      anchor the shared TOC scrolls to + active-tracks.
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

	let {
		title,
		open = $bindable(true),
		sectionKey = undefined,
		index = null,
		accentColor = 'var(--primary)',
		collapsible = true,
		anchor = undefined,
		icon,
		children,
	}: {
		title: string;
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
		icon?: Snippet;
		children?: Snippet;
	} = $props();

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

{#snippet headerContent()}
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

	<h2 class="section-title flex-1 font-heading text-lg font-bold text-[var(--foreground)]">
		{title}
	</h2>
{/snippet}

<!--
  --accent CSS custom property propagates accentColor into the style block.
  Collapsible.Root renders the div we use as the card wrapper.
-->
<Card
	class="section-card {collapsible ? 'section-card--toggleable' : ''}"
	style="--accent: {accentColor};"
	data-toc={anchor}
	onclick={collapsible ? onCardClick : undefined}
>
	<Collapsible bind:open={() => isOpen, setOpen}>
		{#if collapsible}
			<CollapsibleTrigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="section-header flex w-full items-center gap-2.5 px-6 py-4 text-left"
					>
						{@render headerContent()}
						<ChevronToggle open={isOpen} direction="right" />
					</button>
				{/snippet}
			</CollapsibleTrigger>
		{:else}
			<div class="flex items-center gap-2.5 px-6 py-4">
				{@render headerContent()}
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

	/* The open/close animation (grid-template-rows 0fr -> 1fr + opacity, reduced-
	   motion-guarded) lives in transit's CollapsibleContent wrapper. We only need
	   the `.section-body` hook here for the TOC/test contract; no grid rules so
	   the two never fight over the same element. */
</style>
