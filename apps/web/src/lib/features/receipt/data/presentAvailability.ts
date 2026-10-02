import type { ReceiptsIndex, ReceiptAvailability } from '$lib/v1/schemas';
import type { SingleDateOption } from '$lib/components/surface';

export type ReceiptDayKind = 'published' | 'schedule-only' | 'gap' | 'empty';

export interface ReceiptAvailabilityLabels {
	readonly formatDate: (iso: string) => string;
	readonly gap: string;
	readonly empty: string;
	readonly scheduleOnly?: string;
}

export interface ReceiptDateOption extends SingleDateOption {
	readonly label: string;
	readonly disabled: boolean;
	readonly disabledLabel?: string;
}

export interface AvailabilityVM {
	readonly options: ReceiptDateOption[];
	readonly enabledDates: string[];
	readonly hasAny: boolean;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextIsoDay(iso: string): string {
	const d = new Date(`${iso}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

function classify(
	iso: string,
	meta: ReceiptAvailability | undefined,
	published: boolean,
): ReceiptDayKind {
	if (!published) return 'gap';
	if (!meta) return 'published';
	if (meta.has_data) return 'published';
	return meta.has_schedule ? 'schedule-only' : 'empty';
}

export function selectAvailability(
	index: ReceiptsIndex | null | undefined,
	labels: ReceiptAvailabilityLabels,
): AvailabilityVM {
	const dates = (index?.dates ?? []).filter((d) => ISO_RE.test(d));
	if (dates.length === 0) {
		return { options: [], enabledDates: [], hasAny: false };
	}

	const published = new Set(dates);
	const metaByDate = new Map<string, ReceiptAvailability>();
	for (const a of index?.available ?? []) {
		if (ISO_RE.test(a.date)) metaByDate.set(a.date, a);
	}

	const sorted = [...dates].sort();
	const earliest = sorted[0];
	const latest = sorted[sorted.length - 1];

	const options: ReceiptDateOption[] = [];
	const enabledDates: string[] = [];
	let cursor = earliest;
	for (let guard = 0; guard < 1000; guard++) {
		const isPublished = published.has(cursor);
		const kind = classify(cursor, metaByDate.get(cursor), isPublished);
		const enabled = kind === 'published' || kind === 'schedule-only';
		const label = labels.formatDate(cursor);
		options.push({
			date: cursor,
			label:
				kind === 'schedule-only' && labels.scheduleOnly
					? `${label} · ${labels.scheduleOnly}`
					: label,
			disabled: !enabled,
			disabledLabel: kind === 'gap' ? labels.gap : kind === 'empty' ? labels.empty : undefined,
		});
		if (enabled) enabledDates.push(cursor);
		if (cursor === latest) break;
		cursor = nextIsoDay(cursor);
	}

	return { options, enabledDates, hasAny: enabledDates.length > 0 };
}
