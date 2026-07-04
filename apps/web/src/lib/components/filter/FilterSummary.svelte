<!--
  FilterSummary — shared "{count} …" count caption + a "clear filters" link.

  CONTROLLED. Owns no state: the caller passes the already-computed `count`, the
  localized singular/plural count templates, and an `onClear` callback.

  i18n: pluralization is locale-aware. The caller passes a localized singular/plural
  template pair (`countLabel`) carrying the full "{count} noun" phrasing per form,
  e.g. { singular: '{count} alert', plural: '{count} alerts' }. The component picks
  the form per locale (EN: plural unless count === 1; FR: plural only when count >= 2
  — 0 and 1 are singular in French) and substitutes {count}. Ported from yesid.dev's
  shared/FilterSummary; rewired to transit's Locale idiom (a Locale-keyed template +
  clear label resolved via getLocale(), no resolveLocale/siteLabels).
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';

	const clearLabels: Record<Locale, string> = {
		en: 'Clear filters',
		fr: 'Effacer les filtres',
	};

	interface CountTemplate {
		/** "{count} noun" template for the singular form. */
		readonly singular: string;
		/** "{count} noun" template for the plural form. */
		readonly plural: string;
	}

	let {
		count,
		countLabel,
		onClear,
	}: {
		count: number;
		/** Localized singular/plural count phrasing, keyed by Locale. Each form carries
		 *  the full "{count} noun" template so the noun + its plural marker stay per-locale. */
		countLabel: Record<Locale, CountTemplate>;
		onClear: () => void;
	} = $props();

	const locale: Locale = getLocale();
	const clearFiltersLabel = clearLabels[locale];

	// Per-locale plural selection. French treats 0 as singular; English does not.
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
