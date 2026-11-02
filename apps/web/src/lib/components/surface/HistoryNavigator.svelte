<script module lang="ts">
	import type { DateWindow } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { DateRangePickerLabels, SingleDateOption } from './DateRangePicker.svelte';

	export interface HistoryNavigatorLabels {
		readonly group: string;
		readonly picker: DateRangePickerLabels;
		readonly previous: string;
		readonly next: string;
	}

	export interface HistoryNavigatorProps {
		readonly mode: 'range' | 'date';
		readonly locale: Locale;
		readonly labels: HistoryNavigatorLabels;
		readonly value?: DateWindow;
		readonly date?: string;
		readonly availableDates?: readonly string[];
		readonly dateOptions?: readonly SingleDateOption[];
		readonly previousDate?: string | null;
		readonly nextDate?: string | null;
		readonly coverageText?: string | null;
		readonly selectionText?: string | null;
		readonly announcement?: string | null;
		readonly liveAnnouncement?: boolean;
		readonly onRangeChange?: (value: DateWindow | undefined) => void;
		readonly onDateChange?: (date: string | undefined) => void;
		readonly emptyReason?: AbsenceReasonKey;
		readonly class?: string;
	}
</script>

<script lang="ts">
	import { SliderButton } from '@yesid/ui/brand';
	import DateRangePicker from './DateRangePicker.svelte';

	let {
		mode,
		locale,
		labels,
		value,
		date,
		availableDates = [],
		dateOptions = [],
		previousDate = null,
		nextDate = null,
		coverageText = null,
		selectionText = null,
		announcement = null,
		liveAnnouncement = true,
		onRangeChange,
		onDateChange,
		emptyReason = 'no-observations',
		class: className,
	}: HistoryNavigatorProps = $props();
</script>

<section
	class={['history-navigator', className]}
	data-slot="history-navigator"
	aria-label={labels.group}
>
	<div class="history-navigator__picker" data-slot="history-picker">
		<DateRangePicker
			mode={mode === 'date' ? 'single' : 'range'}
			{locale}
			labels={labels.picker}
			{availableDates}
			{dateOptions}
			{emptyReason}
			stack
			bind:value={() => value, (next) => onRangeChange?.(next)}
			bind:date={() => date, (next) => onDateChange?.(next)}
		/>
	</div>

	{#if mode === 'date'}
		<div class="history-navigator__neighbors" data-slot="history-neighbors">
			<SliderButton
				direction="previous"
				disabled={previousDate == null || onDateChange == null}
				aria-label={labels.previous}
				onclick={() => onDateChange?.(previousDate ?? undefined)}
			/>
			<SliderButton
				direction="next"
				disabled={nextDate == null || onDateChange == null}
				aria-label={labels.next}
				onclick={() => onDateChange?.(nextDate ?? undefined)}
			/>
		</div>
	{/if}

	<div class="history-navigator__captions" data-slot="history-captions">
		{#if coverageText != null}
			<p class="history-navigator__caption" data-slot="history-coverage">{coverageText}</p>
		{/if}
		{#if selectionText != null}
			<p class="history-navigator__caption" data-slot="history-selection">{selectionText}</p>
		{/if}
		<p
			class="history-navigator__announcement"
			data-slot="history-announcement"
			role={liveAnnouncement ? 'status' : undefined}
			aria-live={liveAnnouncement ? 'polite' : undefined}
			aria-atomic={liveAnnouncement ? 'true' : undefined}
		>
			{announcement ?? ''}
		</p>
	</div>
</section>

<style>
	.history-navigator {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 100%;
		min-width: 0;
	}
	.history-navigator__picker,
	.history-navigator__captions {
		width: 100%;
		max-width: 100%;
		min-width: 0;
	}
	.history-navigator__picker :global([data-slot='date-range']) {
		width: 100%;
		max-width: 100%;
		min-width: 0;
	}
	.history-navigator__neighbors {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		min-width: 0;
	}
	.history-navigator__captions {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.history-navigator__caption,
	.history-navigator__announcement {
		width: 100%;
		max-width: 100%;
		min-width: 0;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
</style>
