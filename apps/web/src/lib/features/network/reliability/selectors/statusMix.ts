// statusMix — the live status-mix segments (the 5 StatusCodes by count).
//
// Ported VERBATIM from the NetworkHealth god-file. The self-normalising 100% status bar
// stays on the shared StackedBar primitive (a stacked-share mark is EXEMPT from the
// absolute-magnitude domain law — each segment's length IS its share of the whole), so this
// selector emits StackedBar-ready StackedSegments, not a ChartSpec. StackedBar drops zeros.

import { STATUS_CODES, type StatusCode, type StatusDist } from '$lib/v1/schemas';
import type { StackedSegment } from '$lib/components/dataviz';

/** code → localized status band label (the SHARED $lib/v1/enumLabels vocabulary). */
export function selectStatusMix(
	dist: StatusDist | null | undefined,
	statusLabel: (code: StatusCode) => string,
): StackedSegment[] {
	return STATUS_CODES.map((code: StatusCode) => ({
		code,
		value: dist ? dist[code] : null,
		label: statusLabel(code),
	}));
}
