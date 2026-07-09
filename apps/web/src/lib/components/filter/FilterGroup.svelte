<!--
  FilterGroup — reusable single-select filter button group: a monospace section
  label + an "All" reset + one button per item, with keyboard nav + ARIA via the
  shared bits-ui ToggleGroup (type=single, vertical).

  CONTROLLED. This component owns NO URL and NO app state — the caller passes the
  current `activeKey` (null = "All") and an `onSelect(key|null)` callback, exactly
  like yesid's original. Selecting an item calls back with its key; selecting "All"
  (or deselecting) calls back with null. The consuming surface keeps owning state.

  Ported faithfully from yesid.dev's shared/FilterGroup. Rewired to transit's
  Locale idiom: the "All" label is a Locale-keyed map resolved via getLocale()
  (no resolveLocale/siteLabels — that's yesid). Dropped yesid's unused `accentColor`
  prop (dead after the 17e-2 ripple removal). The active item wears the amber
  wayfinding voice (--accent-* TEXT accent — station "you are here", not a ground
  CTA); the "All" active state uses --primary (an interaction accent).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { ChevronToggle } from '$lib/components/brand';
	import { getLocale, type Locale } from '$lib/i18n';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';
	import { persisted } from '$lib/stores/persisted.svelte';

	const locale: Locale = getLocale();

	const defaultAllLabel: Record<Locale, string> = { en: 'All', fr: 'Tous' };

	let {
		label,
		items,
		activeKey = null,
		allowDeselect = true,
		collapsible = false,
		startOpen = true,
		persistKey = undefined,
		allLabel = defaultAllLabel,
		density = 'compact',
		onSelect,
		testIdPrefix = undefined,
	}: {
		label: string;
		items: readonly { key: string; label: string }[];
		activeKey?: string | null;
		allowDeselect?: boolean;
		collapsible?: boolean;
		startOpen?: boolean;
		/**
		 * Opt this group's expand/collapse into surviving a locale switch. When set,
		 * a session boolean keyed by `persistKey` (a stable, locale-free string) drives
		 * `isOpen`, seeded with `startOpen`. When absent, a plain local rune is used.
		 */
		persistKey?: string;
		allLabel?: Record<Locale, string>;
		/** Compact is the shared alerts/default density; spacious is opt-in. */
		density?: 'compact' | 'spacious';
		onSelect: (key: string | null) => void;
		testIdPrefix?: string | undefined;
	} = $props();

	// Keyed → session-scoped (survives a locale switch, paints directly in its
	// restored state via persisted()'s synchronous seed); unkeyed → local rune.
	// untrack marks the one-shot init capture as intentional: the key must stay a
	// stable string and startOpen is only the seed, owned locally afterwards.
	const persistedOpen = untrack(() => (persistKey ? persisted(persistKey, startOpen) : null));
	let localOpen = $state(untrack(() => startOpen));
	const isOpen = $derived(persistedOpen ? persistedOpen.value : localOpen);
	function toggleOpen(): void {
		if (persistedOpen) persistedOpen.value = !persistedOpen.value;
		else localOpen = !localOpen;
	}

	// Map activeKey to ToggleGroup value: null → '__all__', string → string.
	const groupValue = $derived(activeKey ?? '__all__');

	function handleValueChange(value: string) {
		if (!value) {
			// Deselect: ToggleGroup cleared the selection.
			if (allowDeselect) onSelect(null);
			// If !allowDeselect, the controlled value prop keeps the current selection.
			return;
		}
		onSelect(value === '__all__' ? null : value);
	}
</script>

<div data-density={density}>
	{#if collapsible}
		<button
			type="button"
			class="tap-press flex w-full items-center justify-between label-section text-sm font-semibold py-2.5 min-h-11 transition-colors hover:text-[var(--foreground)] active:text-[var(--foreground)]"
			onclick={toggleOpen}
		>
			{label}
			<ChevronToggle open={isOpen} size="sm" direction="down" />
		</button>
	{:else}
		<div class="label-section text-sm font-semibold">
			{label}
		</div>
	{/if}

	<div class="filter-collapse" class:filter-open={!collapsible || isOpen}>
		<div class="filter-collapse-inner">
			<ToggleGroup
				type="single"
				value={groupValue}
				onValueChange={handleValueChange}
				class="mt-2 flex w-full flex-col gap-1"
				orientation="vertical"
			>
				<ToggleGroupItem value="__all__">
					{#snippet child({ props })}
						<button
							{...props}
							class="tap-press filter-btn w-full rounded py-3 min-h-11 text-left transition-colors"
							class:px-2={density === 'compact'}
							class:text-sm={density === 'compact'}
							class:px-3={density === 'spacious'}
							class:text-base={density === 'spacious'}
							class:active={activeKey === null}
						>
							{allLabel[locale]}
						</button>
					{/snippet}
				</ToggleGroupItem>

				{#each items as item (item.key)}
					<ToggleGroupItem value={item.key}>
						{#snippet child({ props })}
							<button
								{...props}
								class="tap-press filter-btn w-full rounded border border-border py-3 min-h-11 text-left text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] active:border-[var(--primary)] active:text-[var(--primary)]"
								class:px-2={density === 'compact'}
								class:text-sm={density === 'compact'}
								class:px-3={density === 'spacious'}
								class:text-base={density === 'spacious'}
								class:tag-active={activeKey === item.key}
								data-testid={testIdPrefix ? `${testIdPrefix}-${item.key}` : undefined}
							>
								{item.label}
							</button>
						{/snippet}
					</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		</div>
	</div>
</div>

<style>
	.filter-btn {
		background: var(--card);
		border: 1px solid var(--border-subtle);
		box-shadow: inset 0 1px 0 var(--edge-highlight);
		color: var(--muted-foreground);
	}

	/* The "All" active chip = an INTERACTION accent → --primary (pairs with
	   --primary-foreground for AA text-on-fill). */
	.active {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
	}

	/* A selected item chip = the amber wayfinding voice: SOLID --accent-surface
	   (no alpha — the grid never bleeds through), --accent-text type, and an
	   --accent "you are here" lamp on the right edge (absolute, zero layout shift).
	   `.filter-btn.tag-active` (+ Svelte's scope hash) outranks the button's inline
	   hover:/active: primary utilities, so the selected chip keeps the amber voice
	   on hover without reaching for !important. */
	.filter-btn.tag-active {
		border-color: var(--accent-text);
		color: var(--accent-text);
		background: var(--accent-surface);
		position: relative;
	}
	.tag-active::after {
		content: '';
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}

	/* Smooth collapse/expand via CSS grid rows. */
	.filter-collapse {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows var(--duration-slow) var(--ease-default);
	}
	.filter-collapse.filter-open {
		grid-template-rows: 1fr;
	}
	.filter-collapse-inner {
		overflow: hidden;
		min-height: 0;
	}
</style>
