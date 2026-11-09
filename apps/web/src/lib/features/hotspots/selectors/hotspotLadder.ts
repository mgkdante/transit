import type { Locale } from '#lib/i18n/index.ts';
import type { ChartDatumPopoverModel } from '#lib/components/dataviz/chart/index.ts';
import {
	encodeSevereLadder,
	type SevereLadderLabels,
	type SevereLadderEvidence as HotspotPopoverEvidence,
	type SevereLadderResult as HotspotLadderResult,
} from '#lib/reliability/severeLadder.ts';
import type { HotspotEntry } from '#lib/v1/schemas/index.ts';

export type { HotspotPopoverEvidence, HotspotLadderResult };

export interface HotspotLadderLabels extends SevereLadderLabels<HotspotEntry> {
	unnamed: (id: string) => string;
	tapPopover: (
		entry: HotspotEntry,
		href: string | null,
		evidence: HotspotPopoverEvidence,
	) => ChartDatumPopoverModel;
}

export function selectHotspotLadder(
	entries: readonly HotspotEntry[],
	cap: number,
	locale: Locale,
	labels: HotspotLadderLabels,
): HotspotLadderResult {
	return encodeSevereLadder(entries, cap, locale, labels, {
		key: (entry) => `${entry.type}-${entry.id}`,
		label: (entry) => entry.name ?? labels.unnamed(entry.id),
	});
}
