import type { DateWindow } from './window';
import type {
	AlertArchiveIndex,
	HistoricCollectionIndex,
	HistoricCoverageGap,
	ReceiptsIndex,
} from '$lib/v1/schemas';

export type HistoryAvailability =
	| { readonly kind: 'empty' }
	| {
			readonly kind: 'continuous';
			readonly firstDate: string;
			readonly lastDate: string;
			readonly gaps: readonly HistoricCoverageGap[];
	  }
	| { readonly kind: 'discrete'; readonly dates: readonly string[] };

export interface HistoryCorrection {
	readonly key: string;
	readonly reason: 'malformed' | 'outside-coverage' | 'gap' | 'unpublished';
}

export interface ResolvedHistoryDate {
	readonly selection: string | null;
	readonly canonicalDate: string | null;
	readonly correction: HistoryCorrection | null;
}

export interface ResolvedHistoryRange {
	readonly selection: DateWindow | null;
	readonly canonicalWindow: DateWindow | null;
	readonly intersectingGaps: readonly HistoricCoverageGap[];
	readonly correction: HistoryCorrection | null;
}

type CorrectionReason = HistoryCorrection['reason'];

function isAbsent(value: unknown): boolean {
	return value === undefined || value === null;
}

function validGaps(gaps: readonly HistoricCoverageGap[]): HistoricCoverageGap[] {
	return gaps.filter(
		(gap) =>
			strictIsoDate(gap.start_date) &&
			strictIsoDate(gap.end_date) &&
			gap.start_date <= gap.end_date,
	);
}

function inGap(date: string, gaps: readonly HistoricCoverageGap[]): boolean {
	return validGaps(gaps).some((gap) => gap.start_date <= date && date <= gap.end_date);
}

function correction(
	scope: 'date' | 'range',
	reason: CorrectionReason,
	values: readonly unknown[],
): HistoryCorrection {
	const suffix = values
		.map((value) => encodeURIComponent(value === undefined || value === null ? '' : String(value)))
		.join(':');
	return { key: `history-${scope}:${reason}:${suffix}`, reason };
}

function reasonUnavailable(
	date: string,
	availability: HistoryAvailability,
): CorrectionReason | null {
	if (availability.kind === 'empty') return 'outside-coverage';

	if (availability.kind === 'continuous') {
		if (date < availability.firstDate || date > availability.lastDate) {
			return 'outside-coverage';
		}
		return inGap(date, availability.gaps) ? 'gap' : null;
	}

	const dates = normalizedDates(availability.dates);
	if (dates.length === 0 || date < dates[0] || date > dates[dates.length - 1]) {
		return 'outside-coverage';
	}
	return dates.includes(date) ? null : 'unpublished';
}

function normalizedDates(dates: readonly string[]): string[] {
	return [...new Set(dates.filter(strictIsoDate))].sort();
}

function gapsIntersecting(
	window: DateWindow,
	availability: HistoryAvailability,
): HistoricCoverageGap[] {
	if (availability.kind !== 'continuous') return [];
	return validGaps(availability.gaps).filter(
		(gap) => gap.start_date <= window.to && gap.end_date >= window.from,
	);
}

export function strictIsoDate(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year === 0) return false;
	const candidate = new Date(0);
	candidate.setUTCHours(0, 0, 0, 0);
	candidate.setUTCFullYear(year, month - 1, day);
	return (
		candidate.getUTCFullYear() === year &&
		candidate.getUTCMonth() === month - 1 &&
		candidate.getUTCDate() === day
	);
}

export function addIsoDays(date: string, days: number): string {
	if (!strictIsoDate(date) || !Number.isInteger(days)) {
		throw new RangeError('addIsoDays requires a real ISO date and an integer day count');
	}

	const candidate = new Date(`${date}T00:00:00.000Z`);
	candidate.setUTCDate(candidate.getUTCDate() + days);
	return candidate.toISOString().slice(0, 10);
}

export function datesForAvailability(availability: HistoryAvailability): string[] {
	if (availability.kind === 'empty') return [];
	if (availability.kind === 'discrete') return normalizedDates(availability.dates);
	if (
		!strictIsoDate(availability.firstDate) ||
		!strictIsoDate(availability.lastDate) ||
		availability.firstDate > availability.lastDate
	) {
		return [];
	}

	const dates: string[] = [];
	for (
		let date = availability.firstDate;
		date <= availability.lastDate;
		date = addIsoDays(date, 1)
	) {
		if (!inGap(date, availability.gaps)) dates.push(date);
	}
	return dates;
}

export function availabilityFromAlertIndex(
	index: AlertArchiveIndex | null,
): HistoryAvailability | null {
	if (index === null) return null;
	const pageRefs = index.months.flatMap((month) => month.pages);
	const firstDates = [
		index.first_available_date,
		...pageRefs.map((ref) => ref.coverage_start),
	].filter(strictIsoDate);
	const lastDates = [index.last_available_date, ...pageRefs.map((ref) => ref.coverage_end)].filter(
		strictIsoDate,
	);
	if (firstDates.length === 0 || lastDates.length === 0) {
		return { kind: 'empty' };
	}
	const firstDate = firstDates.reduce((first, value) => (value < first ? value : first));
	const lastDate = lastDates.reduce((last, value) => (value > last ? value : last));
	if (firstDate > lastDate) return { kind: 'empty' };
	return {
		kind: 'continuous',
		firstDate,
		lastDate,
		gaps: [],
	};
}

export function availabilityFromCollectionIndex(
	index: HistoricCollectionIndex,
): HistoryAvailability {
	if (
		!strictIsoDate(index.first_available_date) ||
		!strictIsoDate(index.last_available_date) ||
		index.first_available_date > index.last_available_date
	) {
		return { kind: 'empty' };
	}
	return {
		kind: 'continuous',
		firstDate: index.first_available_date,
		lastDate: index.last_available_date,
		gaps: validGaps(index.gaps ?? []),
	};
}

export function defaultWindowFromCollectionIndex(index: HistoricCollectionIndex): DateWindow {
	const availability = availabilityFromCollectionIndex(index);
	if (availability.kind !== 'continuous') {
		throw new RangeError('collection has no retained default window');
	}
	return { from: availability.firstDate, to: availability.lastDate };
}

export function availabilityFromReceiptsIndex(index: ReceiptsIndex | null): HistoryAvailability {
	const dates = normalizedDates(index?.dates ?? []);
	return dates.length === 0 ? { kind: 'empty' } : { kind: 'discrete', dates };
}

export function availabilityFromPointCollectionIndex(
	index: HistoricCollectionIndex | null,
): HistoryAvailability {
	const dates = normalizedDates(index?.available_dates ?? []);
	return dates.length === 0 ? { kind: 'empty' } : { kind: 'discrete', dates };
}

export function resolveHistoryDate(
	rawDate: unknown,
	availability: HistoryAvailability,
): ResolvedHistoryDate {
	const dates = datesForAvailability(availability);
	if (dates.length === 0) {
		return { selection: null, canonicalDate: null, correction: null };
	}

	const latest = dates[dates.length - 1];
	if (isAbsent(rawDate)) {
		return { selection: latest, canonicalDate: null, correction: null };
	}
	if (!strictIsoDate(rawDate)) {
		return {
			selection: latest,
			canonicalDate: null,
			correction: correction('date', 'malformed', [rawDate]),
		};
	}

	const reason = reasonUnavailable(rawDate, availability);
	if (reason !== null) {
		return {
			selection: latest,
			canonicalDate: null,
			correction: correction('date', reason, [rawDate]),
		};
	}

	return {
		selection: rawDate,
		canonicalDate: rawDate === latest ? null : rawDate,
		correction: null,
	};
}

export function resolveHistoryRange(
	rawFrom: unknown,
	rawTo: unknown,
	availability: HistoryAvailability,
	defaultWindow: DateWindow,
): ResolvedHistoryRange {
	if (datesForAvailability(availability).length === 0) {
		return {
			selection: null,
			canonicalWindow: null,
			intersectingGaps: [],
			correction: null,
		};
	}

	const fallback = (reason: CorrectionReason | null): ResolvedHistoryRange => ({
		selection: defaultWindow,
		canonicalWindow: null,
		intersectingGaps: gapsIntersecting(defaultWindow, availability),
		correction: reason === null ? null : correction('range', reason, [rawFrom, rawTo]),
	});

	if (isAbsent(rawFrom) && isAbsent(rawTo)) return fallback(null);
	if (!strictIsoDate(rawFrom) || !strictIsoDate(rawTo)) return fallback('malformed');

	const selection: DateWindow =
		rawFrom <= rawTo ? { from: rawFrom, to: rawTo } : { from: rawTo, to: rawFrom };
	const fromReason = reasonUnavailable(selection.from, availability);
	if (fromReason !== null) return fallback(fromReason);
	const toReason = reasonUnavailable(selection.to, availability);
	if (toReason !== null) return fallback(toReason);

	return {
		selection,
		canonicalWindow: selection,
		intersectingGaps: gapsIntersecting(selection, availability),
		correction: null,
	};
}

export function previousAvailableDate(
	date: string,
	availability: HistoryAvailability,
): string | null {
	if (!strictIsoDate(date)) return null;
	return datesForAvailability(availability).findLast((candidate) => candidate < date) ?? null;
}

export function nextAvailableDate(date: string, availability: HistoryAvailability): string | null {
	if (!strictIsoDate(date)) return null;
	return datesForAvailability(availability).find((candidate) => candidate > date) ?? null;
}
