<!-- Free-text listing search. `label` is the accessible name; the placeholder is only a hint. -->
<script lang="ts" module>
	export interface SearchInputProps {
		value?: string;
		label: string;
		placeholder: string;
		/** Defaults to `testId`, else `listing-search`. */
		name?: string;
		testId?: string;
	}
</script>

<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';

	let {
		value = $bindable(''),
		label,
		placeholder,
		testId,
		name = testId ?? 'listing-search',
	}: SearchInputProps = $props();
</script>

<div class="relative" data-slot="listing-search-field">
	<input
		type="text"
		{name}
		aria-label={label}
		{placeholder}
		bind:value
		class="w-full rounded-lg border border-[var(--input)] bg-[var(--card)] px-4 py-3.5 min-h-11 pl-10 font-mono text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] outline-none transition-colors focus:border-[var(--accent)] focus:shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
		data-testid={testId}
	/>
	<SearchIcon
		class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
		size={16}
		strokeWidth={1.5}
		aria-hidden="true"
	/>
</div>
