<!--
  SearchInput — the shared filter/search field for the data surfaces (slice-9.4).

  The search/lines/stops surfaces each had a near-identical mono input + label
  pair (.search-input / .lines-filter-input / .stops-search-input — same card
  bg, border, radius-md, focus-visible ring). This carries that affordance once:
  a labelled, bindable text/search input with the shared focus ring.

  a11y: the label is associated to the input via `for`/`id` (an id is derived
  when none is passed) and mirrored onto `aria-label` so the control is named
  whether or not the visible label renders. Bilingual copy is passed in by the
  surface. Tokens, no hex; --primary stays interactive-only (focus ring).
-->
<script lang="ts">
	interface SearchInputProps {
		/** Bindable input value. */
		value: string;
		/** Visible + accessible label for the field. */
		label: string;
		/** Placeholder text. */
		placeholder?: string;
		/** Input id — derived from the label when omitted (label association). */
		id?: string;
		/** Input type — 'search' (default) or 'text'. */
		type?: 'search' | 'text';
		/** Optional extra classes on the field wrapper. */
		class?: string;
	}

	let {
		value = $bindable(''),
		label,
		placeholder,
		id,
		type = 'search',
		class: className,
	}: SearchInputProps = $props();

	// Derive a stable id from the label when the caller doesn't supply one, so
	// the <label for> ↔ <input id> association always holds.
	const inputId = $derived(id ?? `search-input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
</script>

<div class={className ? `search-input-field ${className}` : 'search-input-field'}>
	<label class="search-input-label" for={inputId}>{label}</label>
	<input
		id={inputId}
		class="search-input-control"
		{type}
		{placeholder}
		aria-label={label}
		autocomplete="off"
		autocapitalize="none"
		spellcheck="false"
		bind:value
	/>
</div>

<style>
	.search-input-field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 28rem;
	}
	.search-input-label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.search-input-control {
		width: 100%;
		padding: 0.75rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease;
	}
	.search-input-control::placeholder {
		color: var(--muted-foreground);
	}
	.search-input-control:focus-visible {
		outline: none;
		border-color: var(--primary);
		box-shadow: 0 0 0 2px var(--ring);
	}

	@media (prefers-reduced-motion: reduce) {
		.search-input-control {
			transition: none;
		}
	}
</style>
