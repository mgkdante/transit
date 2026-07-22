import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { DateRangePickerLabels } from './DateRangePicker.svelte';
import type { HistoryNavigatorLabels } from './HistoryNavigator.svelte';

const chrome = defineCopy({
	fr: {
		start: 'Du',
		end: 'Au',
		date: { previous: 'Date précédente', next: 'Date suivante' },
		range: { previous: 'Plage précédente', next: 'Plage suivante' },
	},
	en: {
		start: 'From',
		end: 'To',
		date: { previous: 'Previous date', next: 'Next date' },
		range: { previous: 'Previous range', next: 'Next range' },
	},
});

type PickerInput = Omit<DateRangePickerLabels, 'start' | 'end'> &
	Partial<Pick<DateRangePickerLabels, 'start' | 'end'>>;

export interface HistoryCopyInput {
	readonly mode: 'date' | 'range';
	readonly group: string;
	readonly picker: PickerInput;
	readonly previous?: string;
	readonly next?: string;
}

/** Builds the exact label object consumed by HistoryNavigator. */
export function historyCopy(locale: Locale, input: HistoryCopyInput): HistoryNavigatorLabels {
	const shared = chrome[locale];
	const step = shared[input.mode];
	const { group, start, end, clear, anyStart, anyEnd, single } = input.picker;
	return {
		group: input.group,
		picker: {
			group,
			start: start ?? shared.start,
			end: end ?? shared.end,
			clear,
			anyStart,
			anyEnd,
			...(single === undefined ? {} : { single }),
		},
		previous: input.previous ?? step.previous,
		next: input.next ?? step.next,
	};
}
