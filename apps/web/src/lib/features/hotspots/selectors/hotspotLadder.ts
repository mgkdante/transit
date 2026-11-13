import type { LineDirectory } from '#lib/site/lineDirectory.ts';
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
	readonly directory?: LineDirectory;
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
	const directory = labels.directory;
	const result = encodeSevereLadder(entries, cap, locale, labels, {
		key: (entry) => `${entry.type}-${entry.id}`,
		label: (entry) =>
			(entry.type === 'route' || entry.type === 'line') && directory
				? directory.name(entry.id, entry.name).label
				: (entry.name ?? labels.unnamed(entry.id)),
	});
	if (directory && result.spec.kind === 'magnitude-bars') {
		result.spec = {
			...result.spec,
			rows: result.spec.rows.map((row, i) => ({
				...row,
				spoken: ['route', 'line'].includes(entries[i].type)
					? directory.name(entries[i].id, entries[i].name).spoken
					: row.label,
			})),
		};
	}
	return result;
}
