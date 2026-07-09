<!--
  LineCombobox — a bits-ui typeahead combobox for picking ONE entity (a transit
  line) from a large catalogue by typing.

  Built on bits-ui Combobox.Root (type="single"): a text input filters the option
  list diacritics-insensitively as you type, a portal-rendered listbox shows the
  matches, and selecting one sets `value`. Clearing the field (empty + blur, or the
  reset affordance) sets `value` to `null`. WAI-ARIA combobox semantics + roving
  listbox focus come from bits-ui; we only style + wire the token chrome.

  a11y (AA): the Input is the labelled combobox (aria-label from `label`), the
  Trigger toggles the listbox, each Item is an option with a mono glyph + label +
  optional sublabel. Selection is announced via the option's accessible name; the
  clear button carries its own label. --primary is used ONLY for the highlighted /
  selected option (an interaction accent), never as a data mark. Tokens, no hex.

  Reusable + surface-agnostic: it knows nothing about lines or stops — the caller
  supplies the options (already glyph-tagged) + the copy. The stops index binds it
  to its ?route filter; any future surface (S13) can reuse it verbatim.
-->
<script lang="ts" module>
	/** One selectable option in the combobox. */
	export interface LineComboboxOption {
		/** The stable id set on `value` when picked. */
		readonly value: string;
		/** Primary visible label (e.g. a line's short name). */
		readonly label: string;
		/** Optional secondary line under the label (e.g. a line's long name). */
		readonly sublabel?: string | null;
		/** Optional leading mono glyph (decorative — mode identity). */
		readonly glyph?: string;
		/** Folded search haystack (diacritics-stripped) the caller precomputes. */
		readonly search: string;
	}

	export interface LineComboboxProps {
		/** The full option catalogue (unfiltered). */
		options: readonly LineComboboxOption[];
		/** The selected option id, or null when none is chosen (bindable). */
		value: string | null;
		/** Accessible label for the combobox input. */
		label: string;
		/** Input placeholder. */
		placeholder?: string;
		/** Accessible label for the clear affordance. */
		clearLabel: string;
		/** Shown inside the listbox when the typed query matches nothing. */
		emptyLabel: string;
		/** Pure fold fn (diacritics-insensitive) applied to the typed query. */
		fold: (raw: string) => string;
		/** Optional extra classes on the root. */
		class?: string;
	}
</script>

<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		options,
		value = $bindable(null),
		label,
		placeholder,
		clearLabel,
		emptyLabel,
		fold,
		class: className,
	}: LineComboboxProps = $props();

	// The typed query is EPHEMERAL local state (a keystroke stream, not view state);
	// it filters the option list but is never persisted or mirrored. Folded once so
	// the match is diacritics-insensitive + word-order-tolerant (substring per token).
	let search = $state('');
	const foldedQuery = $derived(fold(search));

	const filtered = $derived.by<readonly LineComboboxOption[]>(() => {
		if (!foldedQuery) return options;
		// Token-AND: every whitespace-separated token must appear in the option's
		// precomputed folded haystack, so "80 nord" narrows without caring about order.
		const tokens = foldedQuery.split(/\s+/).filter(Boolean);
		return options.filter((o) => tokens.every((tk) => o.search.includes(tk)));
	});

	// The visible input text: while typing we show the raw query; otherwise the
	// label of the current selection (so a hydrated ?route shows its line name).
	const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? '');

	function clear(): void {
		value = null;
		search = '';
	}
</script>

<Combobox.Root
	type="single"
	value={value ?? ''}
	onValueChange={(v) => {
		value = v ? v : null;
	}}
	onOpenChangeComplete={(open) => {
		// On close, drop the transient typed query so the input snaps back to the
		// selection label (never a stale half-typed fragment).
		if (!open) search = '';
	}}
	items={filtered.map((o) => ({ value: o.value, label: o.label }))}
>
	<div class={cn('line-combobox', className)} data-slot="line-combobox">
		<Combobox.Input
			data-slot="line-combobox-input"
			class="line-combobox-input"
			aria-label={label}
			{placeholder}
			defaultValue={selectedLabel}
			oninput={(e) => (search = e.currentTarget.value)}
		/>
		{#if value}
			<button
				type="button"
				class="line-combobox-clear"
				data-slot="line-combobox-clear"
				aria-label={clearLabel}
				onclick={clear}
			>
				<span aria-hidden="true">✕</span>
			</button>
		{/if}
		<Combobox.Trigger
			data-slot="line-combobox-trigger"
			class="line-combobox-trigger"
			aria-label={label}
		>
			<span aria-hidden="true">⌄</span>
		</Combobox.Trigger>
	</div>

	<Combobox.Portal>
		<Combobox.Content
			data-slot="line-combobox-content"
			class="line-combobox-content"
			sideOffset={6}
		>
			<Combobox.Viewport class="line-combobox-viewport">
				{#each filtered as option (option.value)}
					<Combobox.Item
						data-slot="line-combobox-item"
						class="line-combobox-item"
						value={option.value}
						label={option.label}
					>
						{#snippet children({ selected })}
							{#if option.glyph}
								<span class="line-combobox-item-glyph" aria-hidden="true">{option.glyph}</span>
							{/if}
							<span class="line-combobox-item-body">
								<span class="line-combobox-item-label">{option.label}</span>
								{#if option.sublabel}
									<span class="line-combobox-item-sub">{option.sublabel}</span>
								{/if}
							</span>
							{#if selected}
								<span class="line-combobox-item-check" aria-hidden="true">✓</span>
							{/if}
						{/snippet}
					</Combobox.Item>
				{:else}
					<p class="line-combobox-empty">{emptyLabel}</p>
				{/each}
			</Combobox.Viewport>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>

<style>
	/* The trigger row: a mono input carrying the same card/border/focus chrome as
	   SearchInput, with a clear (✕) + open (⌄) affordance tucked at the trailing
	   edge. Tokens only; --primary is reserved for the highlighted option below. */
	.line-combobox {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
	}
	:global(.line-combobox-input) {
		flex: 1 1 auto;
		min-width: 0;
		/* Tap-target floor (P5.3d §C4 P10): the input row was 39px tall → 44px. */
		min-height: var(--size-tap-min);
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		/* Right padding reserves room for the 44px clear + trigger hit areas. */
		padding: 0.5rem 5.25rem 0.5rem 0.75rem;
		line-height: 1.4;
	}
	:global(.line-combobox-input::placeholder) {
		color: var(--muted-foreground);
	}
	:global(.line-combobox-input:focus-visible) {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.line-combobox-clear,
	:global(.line-combobox-trigger) {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* Tap-target floor (P5.3d §C4 P10): the clear/open affordances were 28px
		   square → a full --size-tap-min hit area (the glyph stays visually small). */
		width: var(--size-tap-min);
		height: var(--size-tap-min);
		color: var(--muted-foreground);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-mono);
	}
	.line-combobox-clear {
		right: 2.5rem;
		font-size: var(--text-small);
	}
	:global(.line-combobox-trigger) {
		right: 0;
		font-size: var(--text-body);
	}
	.line-combobox-clear:hover,
	:global(.line-combobox-trigger:hover) {
		color: var(--foreground);
	}
	.line-combobox-clear:focus-visible,
	:global(.line-combobox-trigger:focus-visible) {
		outline: 2px solid var(--primary);
		outline-offset: 1px;
	}

	/* The portal-rendered listbox: a bordered card popover, capped height with
	   scroll, anchored to the input width. */
	:global(.line-combobox-content) {
		z-index: var(--z-menu);
		width: var(--bits-combobox-anchor-width);
		max-height: min(20rem, var(--bits-combobox-content-available-height));
		overflow-y: auto;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md, 0 4px 12px rgb(0 0 0 / 0.15));
		padding: 0.25rem;
	}
	:global(.line-combobox-item) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: var(--radius-sm);
		font-size: var(--text-small);
		color: var(--foreground);
		cursor: pointer;
		user-select: none;
	}
	/* Highlight (keyboard/pointer) + selected = an INTERACTION accent → --primary. */
	:global(.line-combobox-item[data-highlighted]),
	:global(.line-combobox-item[data-selected]) {
		background: color-mix(in oklab, var(--primary) 14%, transparent);
	}
	:global(.line-combobox-item-glyph) {
		font-family: var(--font-mono);
		color: var(--muted-foreground);
		flex: none;
	}
	.line-combobox-item-body {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.line-combobox-item-label {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.line-combobox-item-sub {
		font-size: var(--text-micro);
		color: var(--muted-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.line-combobox-item-check) {
		margin-left: auto;
		color: var(--primary);
		flex: none;
	}
	.line-combobox-empty {
		padding: 0.625rem 0.75rem;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
