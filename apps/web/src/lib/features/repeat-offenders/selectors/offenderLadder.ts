import type { Locale } from '#lib/i18n/index.ts';
import {
	encodeSevereLadder,
	type SevereLadderLabels,
	type SevereLadderEvidence as OffenderPopoverEvidence,
	type SevereLadderResult as OffenderLadderResult,
} from '#lib/reliability/severeLadder.ts';
import type { RepeatOffenderEntry } from '#lib/v1/schemas/index.ts';

export type { OffenderPopoverEvidence, OffenderLadderResult };

export interface OffenderLadderLabels extends SevereLadderLabels<RepeatOffenderEntry> {
	unnamed: (e: RepeatOffenderEntry) => string;
}

export function selectOffenderLadder(
	entries: readonly RepeatOffenderEntry[],
	cap: number,
	locale: Locale,
	labels: OffenderLadderLabels,
): OffenderLadderResult {
	return encodeSevereLadder(entries, cap, locale, labels, {
		key: (entry) => `${entry.type}-${entry.id}-${entry.route ?? ''}`,
		label: (entry) => entry.route_name ?? labels.unnamed(entry),
	});
}
