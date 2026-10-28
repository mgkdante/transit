<script lang="ts">
	import type { AlertHistoryCopy } from '../alerts.copy';
	import type { Locale } from '$lib/i18n';
	import { SEVERITY_CODES, type SeverityCode } from '$lib/v1/schemas/types';
	import type { AlertAffects, DateWindow } from '$lib/filters';
	import { ArticleControlStack, HistoryNavigator } from '$lib/components/surface';
	import { FilterSummary, SegmentedChoice } from '@yesid/ui/brand';
	import { Combobox, type ComboboxOption } from '@yesid/ui/combobox';
	import { foldSearchText } from '$lib/search/normalize';

	interface Props {
		affects: 'all' | AlertAffects;
		severity: 'all' | SeverityCode;
		route: string | null;
		stop: string | null;
		window: DateWindow | undefined;
		lineOptions: readonly ComboboxOption[];
		stopOptions: readonly ComboboxOption[];
		availableDates: readonly string[];
		filtersActive: boolean;
		matchCount: number | null;
		copy: AlertHistoryCopy;
		locale: Locale;
		historyCoverageText: string | null;
		historySelectionText: string | null;
		historyAnnouncement: string | null;
		onWindowChange: (window: DateWindow | undefined) => void;
		onClear: () => void;
	}
	let {
		affects = $bindable(),
		severity = $bindable(),
		route = $bindable(),
		stop = $bindable(),
		window,
		lineOptions,
		stopOptions,
		availableDates,
		filtersActive,
		matchCount,
		copy,
		locale,
		historyCoverageText,
		historySelectionText,
		historyAnnouncement,
		onWindowChange,
		onClear,
	}: Props = $props();

	const entityItems = $derived<{ key: string; label: string }[]>([
		{ key: 'lines', label: copy.filters.entity.lines },
		{ key: 'stops', label: copy.filters.entity.stops },
	]);
	const severityItems = $derived<{ key: string; label: string }[]>(
		SEVERITY_CODES.map((code) => ({ key: code, label: copy.severity[code] })),
	);

	function setAffects(key: string | null): void {
		affects = (key ?? 'all') as 'all' | AlertAffects;
	}
	function setSeverity(key: string | null): void {
		severity = (key ?? 'all') as 'all' | SeverityCode;
	}
</script>

{#snippet choiceGroup(
	label: string,
	allLabel: string,
	items: readonly { key: string; label: string }[],
	activeKey: string | null,
	onSelect: (key: string | null) => void,
)}
	<div>
		<div class="label-section text-sm font-semibold">{label}</div>
		<SegmentedChoice
			options={[{ key: '__all__', label: allLabel }, ...items]}
			value={activeKey ?? '__all__'}
			{label}
			variant="joined-grid"
			class="mt-2"
			onSelect={(key) => onSelect(key === '__all__' || key === activeKey ? null : key)}
		/>
	</div>
{/snippet}

{#snippet summaryControls()}
	<div class="alert-history-summary" data-slot="filter-summary-wrap">
		<FilterSummary
			count={matchCount ?? 0}
			countLabel={copy.filters.summary[locale]}
			{locale}
			clearLabel={copy.filters.clearFilters}
			{onClear}
		/>
	</div>
{/snippet}

<div
	class="alert-filters-body"
	data-slot="alert-filters"
	role="group"
	aria-label={copy.filters.railLabel}
>
	<ArticleControlStack caption={filtersActive && matchCount != null ? summaryControls : undefined}>
		{#snippet history()}
			<div class="alert-history-pick" data-slot="window-pick">
				<HistoryNavigator
					mode="range"
					{locale}
					labels={copy.filters.history.navigator}
					value={window}
					{availableDates}
					coverageText={historyCoverageText}
					selectionText={historySelectionText}
					announcement={historyAnnouncement}
					liveAnnouncement={false}
					onRangeChange={onWindowChange}
				/>
			</div>
		{/snippet}

		{#snippet primary()}
			<div class="alert-filter-groups">
				{@render choiceGroup(
					copy.filters.entity.label,
					copy.filters.entity.all,
					entityItems,
					affects === 'all' ? null : affects,
					setAffects,
				)}
				{@render choiceGroup(
					copy.filters.severity.label,
					copy.filters.severity.all,
					severityItems,
					severity === 'all' ? null : severity,
					setSeverity,
				)}
			</div>
		{/snippet}

		{#snippet secondary()}
			<div class="alert-filter-specifics">
				<div class="alert-history-pick" data-slot="line-pick">
					<span class="alert-history-pick-label" aria-hidden="true">{copy.filters.line.label}</span>
					<Combobox
						options={lineOptions}
						bind:value={route}
						label={copy.filters.line.label}
						placeholder={copy.filters.line.placeholder}
						clearLabel={copy.filters.line.clear}
						emptyLabel={copy.filters.line.empty}
						fold={foldSearchText}
					/>
				</div>
				<div class="alert-history-pick" data-slot="stop-pick">
					<span class="alert-history-pick-label" aria-hidden="true">{copy.filters.stop.label}</span>
					<Combobox
						options={stopOptions}
						bind:value={stop}
						label={copy.filters.stop.label}
						placeholder={copy.filters.stop.placeholder}
						clearLabel={copy.filters.stop.clear}
						emptyLabel={copy.filters.stop.empty}
						fold={foldSearchText}
					/>
				</div>
			</div>
		{/snippet}
	</ArticleControlStack>
</div>

<style>
	.alert-filters-body {
		min-width: 0;
	}
	.alert-filter-groups,
	.alert-filter-specifics {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	.alert-history-pick {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
	}
	.alert-history-pick-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.alert-history-summary {
		width: 100%;
	}
</style>
