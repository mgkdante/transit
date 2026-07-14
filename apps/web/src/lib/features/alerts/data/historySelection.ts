import type { DateWindow } from '$lib/filters';
import {
	availabilityFromAlertIndex,
	resolveHistoryRange,
	strictIsoDate,
	type HistoryAvailability,
	type ResolvedHistoryRange,
} from '$lib/v1/history';
import type { AlertArchiveIndex, AlertHistory } from '$lib/v1/schemas';
import { deriveSpan } from '../selectors/alertLog';

function realDate(value: string | null | undefined): string | null {
	if (value == null) return null;
	const date = value.slice(0, 10);
	return strictIsoDate(date) ? date : null;
}

function legacyWindow(history: AlertHistory): DateWindow | null {
	const windowStart = realDate(history.window_start);
	const windowEnd = realDate(history.window_end);
	if (windowStart != null && windowEnd != null && windowStart <= windowEnd) {
		return { from: windowStart, to: windowEnd };
	}

	const span = deriveSpan(history.alerts ?? []);
	if (span == null || !strictIsoDate(span.start) || !strictIsoDate(span.end)) return null;
	return { from: span.start, to: span.end };
}

export function currentAlertWindow(
	history: AlertHistory,
	index: AlertArchiveIndex | null,
): DateWindow | null {
	const current = legacyWindow(history);
	if (index == null) return current;

	const availability = availabilityFromAlertIndex(index);
	if (availability == null || availability.kind !== 'continuous') return null;

	const latest = availability.lastDate;
	if (current == null) return { from: latest, to: latest };

	const from = current.from < availability.firstDate ? availability.firstDate : current.from;
	const to = current.to > availability.lastDate ? availability.lastDate : current.to;
	return from <= to ? { from, to } : { from: latest, to: latest };
}

export function resolveAlertHistoryRange(
	history: AlertHistory,
	index: AlertArchiveIndex | null,
	rawFrom: unknown,
	rawTo: unknown,
): ResolvedHistoryRange {
	const defaultWindow = currentAlertWindow(history, index);
	const availability: HistoryAvailability =
		index == null && defaultWindow != null
			? {
					kind: 'continuous',
					firstDate: defaultWindow.from,
					lastDate: defaultWindow.to,
					gaps: [],
				}
			: (availabilityFromAlertIndex(index) ?? { kind: 'empty' });
	if (defaultWindow == null) {
		return {
			selection: null,
			canonicalWindow: null,
			intersectingGaps: [],
			correction: null,
		};
	}
	return resolveHistoryRange(rawFrom, rawTo, availability, defaultWindow);
}

export function sameHistoryWindow(
	left: DateWindow | null | undefined,
	right: DateWindow | null | undefined,
): boolean {
	if (left == null || right == null) return left == null && right == null;
	const normalizedLeft = left.from <= left.to ? left : { from: left.to, to: left.from };
	const normalizedRight = right.from <= right.to ? right : { from: right.to, to: right.from };
	return normalizedLeft.from === normalizedRight.from && normalizedLeft.to === normalizedRight.to;
}
