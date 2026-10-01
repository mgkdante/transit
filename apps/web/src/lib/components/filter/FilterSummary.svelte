<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';

	const clearLabels: Record<Locale, string> = {
		en: 'Clear filters',
		fr: 'Effacer les filtres',
	};

	interface CountTemplate {
		readonly singular: string;
		readonly plural: string;
	}

	let {
		count,
		countLabel,
		onClear,
	}: {
		count: number;
		countLabel: Record<Locale, CountTemplate>;
		onClear: () => void;
	} = $props();

	const locale: Locale = getLocale();
	const clearFiltersLabel = clearLabels[locale];

	const isPlural = $derived(locale === 'fr' ? count >= 2 : count !== 1);
	const summaryText = $derived(
		(isPlural ? countLabel[locale].plural : countLabel[locale].singular).replace(
			'{count}',
			String(count),
		),
	);
</script>

<div class="mb-3 flex items-center gap-2" data-slot="filter-summary">
	<span class="text-xs text-[var(--muted-foreground)]" data-slot="filter-summary-count">
		{summaryText}
	</span>
	<button
		type="button"
		class="tap-feedback inline-flex items-center min-h-11 px-2 font-mono text-caption text-primary underline transition-colors hover:text-[var(--foreground)] active:text-[var(--foreground)]"
		data-slot="clear-filters"
		onclick={onClear}
	>
		{clearFiltersLabel}
	</button>
</div>
