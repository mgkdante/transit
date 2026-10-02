<script lang="ts">
	export interface SearchInputProps {
		value: string;
		label: string;
		placeholder?: string;
		id?: string;
		type?: 'search' | 'text';
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
		gap: 0.375rem;
		max-width: 28rem;
	}
	.search-input-label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.search-input-control {
		width: 100%;
		min-height: var(--size-tap-min);
		padding: 0.75rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
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
