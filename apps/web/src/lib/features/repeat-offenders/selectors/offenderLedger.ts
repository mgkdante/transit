import type { SeverityCode, Offender } from '#lib/v1/schemas/index.ts';
import type { LineDirectory } from '#lib/site/lineDirectory.ts';

const SEVERITY_MAP: Readonly<Record<string, SeverityCode>> = {
	critical: 'critical',
	high: 'high',
	watch: 'watch',
};

export function publishedSeverity(severity: string | null | undefined): SeverityCode {
	if (severity == null) return 'watch';
	return SEVERITY_MAP[severity.toLowerCase()] ?? 'watch';
}

export interface OffenderLedgerLabels {
	readonly directory?: LineDirectory;
	typeLabel: (type: string) => string;
	recurrenceLabel: string;
	recurrenceUnknown: string;
	fmtMin: (v: number | null) => string | null;
	href: (o: Offender) => string;
}

export interface OffenderLedgerRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly subtitle: string;
	readonly severity: SeverityCode;
	readonly value: number | null;
	readonly display: string | null;
	readonly href: string;
}

function offenderTitle(o: Offender, typeLabel: (t: string) => string): string {
	const name = o.route_name?.trim();
	if (name) return name;
	const route = o.route?.trim();
	if (route) return `${typeLabel(o.type)} ${route}`;
	return `${typeLabel(o.type)} ${o.id}`;
}

function offenderSubtitle(o: Offender, labels: OffenderLedgerLabels): string {
	const recurrence = o.recurrence?.trim();
	const recurrenceText = recurrence
		? `${labels.recurrenceLabel} ${recurrence}`
		: labels.recurrenceUnknown;
	if (labels.directory) {
		return o.type === 'trip' || o.type === 'vehicle'
			? `${labels.typeLabel(o.type)} ${o.id} · ${recurrenceText}`
			: recurrenceText;
	}
	const route = o.route?.trim();
	const routeText = route && o.route_name?.trim() ? ` · ${labels.typeLabel(o.type)} ${route}` : '';
	return `${recurrenceText}${routeText}`;
}

export function buildOffenderLedger(
	list: readonly Offender[],
	labels: OffenderLedgerLabels,
): OffenderLedgerRow[] {
	const directory = labels.directory;
	return list.map((o, i) => {
		const lineId = o.route || (o.type === 'route' ? o.id : null);
		const name = directory && lineId ? directory.name(lineId, o.route_name) : null;
		const title = name?.label ?? offenderTitle(o, labels.typeLabel);
		const delay = o.avg_delay_min ?? null;
		return {
			key: `${o.type}:${o.id}:${o.route ?? ''}`,
			rank: i + 1,
			title,
			subtitle: offenderSubtitle(o, labels),
			severity: publishedSeverity(o.severity),
			value: delay,
			display: labels.fmtMin(delay),
			href: labels.href(o),
		};
	});
}
