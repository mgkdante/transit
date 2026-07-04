<!--
  AlertFilters — the /alerts filter rail (S15 re-seat; filter-family adoption).

  ONE ControlsRail (quiet infra chrome) collecting the five codec-backed axes:
    · entity-type (Affects) — a shared FilterGroup (All | Lines | Stops)
    · severity — a shared FilterGroup (All | Critical | High | Watch)
    · Line — a typeahead LineCombobox over the distinct lines in the log
    · Stop — a typeahead LineCombobox over the distinct stops in the log
    · date range — the shared DateRangePicker over the served span (?from/?to)

  The two entity-type/severity radiogroups now ride the shared $lib/components/filter
  FilterGroup (bits-ui ToggleGroup + built-in "All" reset), and the bespoke clear
  button rides FilterSummary — a BOUNDED widget swap only. FilterGroup is CONTROLLED
  (activeKey + onSelect), so this file threads the surface's existing $bindable
  scalars through: the built-in "All" maps to the codec's 'all' sentinel (activeKey =
  x==='all' ? null : x; onSelect = (k)=> x = k ?? 'all'). The orchestrator still owns
  the codec seed + batched URL mirror + every predicate — nothing about state or the
  URL changed. The two comboboxes carry the type in their GROUP label ONCE (no per-row
  prefix). --primary lives only on the active chip / highlighted option, never on the rail.
-->
<script lang="ts">
	import type { AlertHistoryCopy } from '../alerts.copy';
	import type { Locale } from '$lib/i18n';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { SEVERITY_CODES } from '$lib/v1/schemas';
	import type { AlertAffects, DateWindow } from '$lib/filters';
	import { DateRangePicker } from '$lib/components/surface';
	import { FilterGroup, FilterSummary } from '$lib/components/filter';
	import { ControlsRail } from '$lib/components/layout';
	import { LineCombobox, type LineComboboxOption } from '$lib/components/ui/line-combobox';
	import { foldSearchText } from '$lib/search/normalize';

	interface Props {
		/** Entity-type axis: 'all' | 'lines' | 'stops' (bindable; 'all' = absent codec value). */
		affects: 'all' | AlertAffects;
		/** Severity axis: 'all' | SeverityCode (bindable). */
		severity: 'all' | SeverityCode;
		/** The chosen line id, or null (bindable — mirrors ?route). */
		route: string | null;
		/** The chosen stop id, or null (bindable — mirrors ?stop). */
		stop: string | null;
		/** The picked date window, or undefined (bindable — mirrors ?from/?to). */
		window: DateWindow | undefined;
		/** Line picker options (distinct lines in the log). */
		lineOptions: readonly LineComboboxOption[];
		/** Stop picker options (distinct stops in the log). */
		stopOptions: readonly LineComboboxOption[];
		/** The served span, every day selectable (empty ⇒ the picker hides via honest absence). */
		availableDates: readonly string[];
		/** True when any axis is active (shows the "clear filters" affordance). */
		filtersActive: boolean;
		/** The count of alerts matching the active filters (already computed upstream). */
		matchCount: number;
		copy: AlertHistoryCopy;
		locale: Locale;
		/** Reset every axis to its unfiltered default. */
		onClear: () => void;
	}
	let {
		affects = $bindable(),
		severity = $bindable(),
		route = $bindable(),
		stop = $bindable(),
		window = $bindable(),
		lineOptions,
		stopOptions,
		availableDates,
		filtersActive,
		matchCount,
		copy,
		locale,
		onClear,
	}: Props = $props();

	// FilterGroup items exclude the built-in "All" (its own reset row supplies it).
	const entityItems = $derived<{ key: string; label: string }[]>([
		{ key: 'lines', label: copy.filters.entity.lines },
		{ key: 'stops', label: copy.filters.entity.stops },
	]);
	const severityItems = $derived<{ key: string; label: string }[]>(
		SEVERITY_CODES.map((code) => ({ key: code, label: copy.severity[code] })),
	);

	// Controlled ↔ codec bridge: 'all' sentinel ⇄ FilterGroup's null "All". The
	// $bindable scalars stay the surface's state; we only translate the null reset.
	function setAffects(key: string | null): void {
		affects = (key ?? 'all') as 'all' | AlertAffects;
	}
	function setSeverity(key: string | null): void {
		severity = (key ?? 'all') as 'all' | SeverityCode;
	}
</script>

<ControlsRail label={copy.filters.railLabel} class="alert-history-filters">
	<FilterGroup
		label={copy.filters.entity.label}
		items={entityItems}
		activeKey={affects === 'all' ? null : affects}
		allLabel={{ en: copy.filters.entity.all, fr: copy.filters.entity.all }}
		onSelect={setAffects}
	/>
	<FilterGroup
		label={copy.filters.severity.label}
		items={severityItems}
		activeKey={severity === 'all' ? null : severity}
		allLabel={{ en: copy.filters.severity.all, fr: copy.filters.severity.all }}
		onSelect={setSeverity}
	/>
	<!-- The two specific-entity typeahead pickers. The group label names the type once;
	     each option is the bare id (no per-row prefix). Single-select, codec-mirrored. -->
	<div class="alert-history-pick" data-slot="line-pick">
		<span class="alert-history-pick-label" aria-hidden="true">{copy.filters.line.label}</span>
		<LineCombobox
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
		<LineCombobox
			options={stopOptions}
			bind:value={stop}
			label={copy.filters.stop.label}
			placeholder={copy.filters.stop.placeholder}
			clearLabel={copy.filters.stop.clear}
			emptyLabel={copy.filters.stop.empty}
			fold={foldSearchText}
		/>
	</div>
	<!-- The shared date-range picker over the served span. Empty coverage → honest
	     absence (the primitive renders an AbsentValue, never a dead control). -->
	<div class="alert-history-pick" data-slot="window-pick">
		<DateRangePicker bind:value={window} {availableDates} {locale} labels={copy.filters.window} />
	</div>
	{#if filtersActive}
		<!-- Shared FilterSummary: the match count + the clear-filters link (BOUNDED swap
		     of the old bespoke button). onClear = the surface's existing reset; the count
		     is the already-computed filtered length. -->
		<div class="alert-history-summary" data-slot="filter-summary-wrap">
			<FilterSummary count={matchCount} countLabel={copy.filters.summary} {onClear} />
		</div>
	{/if}
</ControlsRail>

<style>
	/* Each labeled picker seats in the filter rail beside the two radiogroups. */
	.alert-history-pick {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
		flex: 1 1 16rem;
	}
	.alert-history-pick-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	/* The shared FilterSummary seats full-width on its own row in the rail so the
	   count + clear link never crowd the pickers. It carries its own --primary link
	   treatment (an interaction control), so no bespoke clear styles remain here. */
	.alert-history-summary {
		flex: 1 1 100%;
	}
</style>
