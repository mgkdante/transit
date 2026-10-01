<script module lang="ts">
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';
	import type { DateWindow } from '$lib/filters';

	export interface DateRangePickerLabels {
		readonly group: string;
		readonly start: string;
		readonly end: string;
		readonly clear: string;
		readonly anyStart: string;
		readonly anyEnd: string;
		readonly single?: string;
	}

	export interface SingleDateOption {
		readonly date: string;
	}

	export interface DateRangePickerProps {
		value?: DateWindow | undefined;
		mode?: 'range' | 'single';
		date?: string | undefined;
		dateOptions?: readonly SingleDateOption[];
		availableDates?: readonly string[];
		locale: Locale;
		labels: DateRangePickerLabels;
		emptyReason?: AbsenceReasonKey;
		clearable?: boolean;
		stack?: boolean;
		class?: string;
	}
</script>

<script lang="ts">
	import { normalizeWindow } from '$lib/filters';
	import { AbsentValue } from '$lib/components/edge';

	let {
		value = $bindable(),
		mode = 'range',
		date = $bindable(),
		dateOptions = [],
		availableDates = [],
		locale,
		labels,
		emptyReason = 'no-observations',
		clearable = true,
		stack = false,
		class: className,
	}: DateRangePickerProps = $props();

	let start = $state<string>(value?.from ?? '');
	let end = $state<string>(value?.to ?? '');

	$effect(() => {
		const from = value?.from ?? '';
		const to = value?.to ?? '';
		if (value != null && (from !== start || to !== end)) {
			start = from;
			end = to;
			return;
		}
		if (value == null && start !== '' && end !== '') {
			start = '';
			end = '';
		}
	});

	const hasDates = $derived(mode === 'single' ? dateOptions.length > 0 : availableDates.length > 0);

	const singleLabel = $derived(labels.single ?? labels.group);

	const minDate = $derived(availableDates.length ? availableDates[0] : undefined);
	const maxDate = $derived(
		availableDates.length ? availableDates[availableDates.length - 1] : undefined,
	);
	const singleMin = $derived(dateOptions.length ? dateOptions[0].date : undefined);
	const singleMax = $derived(
		dateOptions.length ? dateOptions[dateOptions.length - 1].date : undefined,
	);

	const toMin = $derived(start || minDate);
	const fromMax = $derived(end || maxDate);

	function emit(nextStart: string, nextEnd: string): void {
		start = nextStart;
		end = nextEnd;
		value = normalizeWindow(nextStart || null, nextEnd || null);
	}

	function clear(): void {
		emit('', '');
	}
</script>

{#if !hasDates}
	<AbsentValue variant="block" reason={emptyReason} {locale} />
{:else if mode === 'single'}
	<div
		class={['date-range', stack && 'date-range--stack', className]}
		data-slot="date-range"
		role="group"
		aria-label={labels.group}
	>
		<label class="date-range__field">
			<span class="date-range__label">{singleLabel}</span>
			<input
				type="date"
				name="history-date"
				class="date-range__input"
				value={date ?? ''}
				min={singleMin}
				max={singleMax}
				onchange={(e) => (date = e.currentTarget.value || undefined)}
				aria-label={singleLabel}
				data-slot="single-date"
			/>
		</label>
	</div>
{:else}
	<div
		class={['date-range', stack && 'date-range--stack', className]}
		data-slot="date-range"
		role="group"
		aria-label={labels.group}
	>
		<label class="date-range__field">
			<span class="date-range__label">{labels.start}</span>
			<input
				type="date"
				name="history-from"
				class="date-range__input"
				value={start}
				min={minDate}
				max={fromMax}
				onchange={(e) => emit(e.currentTarget.value, end)}
				aria-label={`${labels.group} · ${labels.start}`}
			/>
		</label>
		<label class="date-range__field">
			<span class="date-range__label">{labels.end}</span>
			<input
				type="date"
				name="history-to"
				class="date-range__input"
				value={end}
				min={toMin}
				max={maxDate}
				onchange={(e) => emit(start, e.currentTarget.value)}
				aria-label={`${labels.group} · ${labels.end}`}
			/>
		</label>
		{#if clearable && value != null}
			<button type="button" class="date-range__clear" onclick={clear}>{labels.clear}</button>
		{/if}
	</div>
{/if}

<style>
	.date-range {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
		min-width: 0;
	}
	.date-range--stack {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.625rem;
	}
	.date-range--stack .date-range__field {
		justify-content: space-between;
	}
	.date-range--stack .date-range__input {
		flex: 1 1 auto;
		min-width: 0;
	}
	.date-range__field {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.date-range__label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.date-range__input {
		appearance: auto;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 0.375rem 0.5rem;
	}
	.date-range__input:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.date-range__clear {
		appearance: none;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--muted-foreground);
		background-color: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.375rem 0.75rem;
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.date-range__clear:hover {
		color: var(--foreground);
		border-color: var(--primary);
	}
	.date-range__clear:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.date-range__clear {
			transition: none;
		}
	}
</style>
