import type { ReceiptNotReportedRoute, ReceiptServiceStates, SeverityCode } from '$lib/v1/schemas';

export const NOT_REPORTED_DOMAIN: readonly [number, number] = [0, 20];

export interface NotReportedRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly subtitle: string;
	readonly severity: SeverityCode;
	readonly value: number | null;
	readonly domain: readonly [number, number];
	readonly display: string | null;
	readonly href: string;
	readonly ariaLabel: string;
}

export interface NotReportedVM {
	readonly rows: NotReportedRow[];
	readonly shown: number;
	readonly total: number | null;
	readonly hasData: boolean;
}

export interface NotReportedLabels {
	readonly routeName: (id: string, fallbackName: string | null | undefined) => string;
	readonly rowLabel: string;
	readonly href: (id: string) => string;
	readonly viewDetail: (id: string) => string;
	readonly fmtScheduled: (v: number | null | undefined) => string | null;
}

export function selectNotReportedLines(
	states: ReceiptServiceStates | null | undefined,
	labels: NotReportedLabels,
): NotReportedVM {
	const list: readonly ReceiptNotReportedRoute[] = states?.not_reported_routes ?? [];
	const rows: NotReportedRow[] = list.map((r, i) => ({
		key: r.id,
		rank: i + 1,
		title: labels.routeName(r.id, r.name),
		subtitle: labels.rowLabel,
		severity: 'critical' as SeverityCode,
		value: r.scheduled_trip_days ?? null,
		domain: NOT_REPORTED_DOMAIN,
		display: labels.fmtScheduled(r.scheduled_trip_days),
		href: labels.href(r.id),
		ariaLabel: labels.viewDetail(r.id),
	}));
	return {
		rows,
		shown: rows.length,
		total: states?.not_reported_route_count ?? null,
		hasData: rows.length > 0,
	};
}
