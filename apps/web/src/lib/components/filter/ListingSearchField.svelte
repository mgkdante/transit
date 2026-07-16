<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';

	export interface ListingSearchFieldProps {
		value?: string;
		label: string;
		placeholder: string;
		name?: string;
		testId?: string;
	}

	let {
		value = $bindable(''),
		label,
		placeholder,
		testId,
		name = testId ?? 'listing-search',
	}: ListingSearchFieldProps = $props();
</script>

<div class="pt-3 mb-6 pb-5 divider-dashed" data-slot="listing-search-field">
	<div class="relative">
		<input
			type="text"
			{name}
			aria-label={label}
			{placeholder}
			bind:value
			class="w-full rounded-lg border border-[var(--input)] bg-[var(--card)] px-4 py-3.5 min-h-11 pl-10 font-mono text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] outline-none transition-colors focus:border-[var(--primary)]"
			data-testid={testId}
		/>
		<SearchIcon
			class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
			size={16}
			strokeWidth={1.5}
			aria-hidden="true"
		/>
	</div>
</div>
