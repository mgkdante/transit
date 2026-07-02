<!--
  AlertFilters — the /alerts filter rail (S15 re-seat).

  ONE ControlsRail (quiet infra chrome) collecting the five codec-backed axes:
    · entity-type (Affects) — a GrainPicker radiogroup (all|lines|stops)
    · severity — a GrainPicker radiogroup (all|critical|high|watch)
    · Line — a typeahead LineCombobox over the distinct lines in the log
    · Stop — a typeahead LineCombobox over the distinct stops in the log
    · date range — the shared DateRangePicker over the served span (?from/?to)

  The bespoke SearchInput + chip set + ~90 lines of CSS from the old E3 picker are
  GONE — the two comboboxes carry the type in their GROUP label ONCE (no per-row
  "Line NN"/"Stop NNNNN" prefix), and route-24-vs-stop-24 stays disambiguated by the
  separate pickers. Every value is $bindable so the orchestrator owns the codec seed +
  batched URL mirror; this file is a pure control surface. --primary lives only on the
  active chip / highlighted option, never on the rail.
-->
<script lang="ts">
	import type { AlertHistoryCopy } from '../alerts.copy';
	import type { Locale } from '$lib/i18n';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { SEVERITY_CODES } from '$lib/v1/schemas';
	import type { AlertAffects, DateWindow } from '$lib/filters';
	import { GrainPicker, DateRangePicker, type GrainSegment } from '$lib/components/surface';
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
		copy,
		locale,
		onClear,
	}: Props = $props();

	const entitySegments = $derived<GrainSegment<'all' | AlertAffects>[]>([
		{ key: 'all', label: copy.filters.entity.all },
		{ key: 'lines', label: copy.filters.entity.lines },
		{ key: 'stops', label: copy.filters.entity.stops },
	]);
	const severitySegments = $derived<GrainSegment<'all' | SeverityCode>[]>([
		{ key: 'all', label: copy.filters.severity.all },
		...SEVERITY_CODES.map((code) => ({ key: code, label: copy.severity[code] })),
	]);
</script>

<ControlsRail label={copy.filters.railLabel} class="alert-history-filters">
	<GrainPicker segments={entitySegments} bind:value={affects} label={copy.filters.entity.label} />
	<GrainPicker
		segments={severitySegments}
		bind:value={severity}
		label={copy.filters.severity.label}
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
		<button type="button" class="alert-history-clear" data-slot="clear-filters" onclick={onClear}>
			{copy.filters.clear}
		</button>
	{/if}
</ControlsRail>

<style>
	/* Each labeled picker seats in the filter rail beside the two radiogroups. */
	.alert-history-pick {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
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
	/* "Clear filters" — an INTERACTION control, so --primary belongs here. A quiet mono
	   link seated in the filter rail beside the pickers. */
	.alert-history-clear {
		appearance: none;
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--primary);
		background: none;
		border: none;
		padding: 0.15rem 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.alert-history-clear:hover {
		text-decoration-thickness: 2px;
	}
	.alert-history-clear:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm, 0.375rem);
	}
</style>
