import type { LineDirectory } from '#lib/site/lineDirectory.ts';
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
	readonly directory?: LineDirectory;
	unnamed: (e: RepeatOffenderEntry) => string;
}

export function selectOffenderLadder(
	entries: readonly RepeatOffenderEntry[],
	cap: number,
	locale: Locale,
	labels: OffenderLadderLabels,
): OffenderLadderResult {
	const directory = labels.directory;
	const result = encodeSevereLadder(entries, cap, locale, labels, {
		key: (entry) => `${entry.type}-${entry.id}-${entry.route ?? ''}`,
		label: (entry) =>
			directory && entry.route
				? directory.name(entry.route, entry.route_name).label
				: (entry.route_name ?? labels.unnamed(entry)),
	});
	if (directory && result.spec.kind === 'magnitude-bars') {
		result.spec = {
			...result.spec,
			rows: result.spec.rows.map((row, i) => ({
				...row,
				spoken: entries[i].route || entries[i].route_name ? directory.spoken(row.label) : row.label,
			})),
		};
	}
	return result;
}
