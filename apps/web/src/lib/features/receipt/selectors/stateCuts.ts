import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/domains';
import type { ReceiptServiceStates, SeverityCode } from '$lib/v1/schemas';

export type ServiceStateKind = 'delivered' | 'cancelled' | 'silent';

export interface StateCutRow {
	readonly key: ServiceStateKind;
	readonly label: string;
	readonly severity: SeverityCode;
	readonly value: number | null;
	readonly domain: readonly [number, number];
	readonly display: string | null;
}

export interface StateCutsVM {
	readonly completeness: number | null;
	readonly completenessDisplay: string | null;
	readonly rows: StateCutRow[];
	readonly hasData: boolean;
}

export interface StateCutsLabels {
	readonly delivered: string;
	readonly cancelled: string;
	readonly silent: string;
	readonly fmtSharePct: (v: number | null) => string | null;
}

function stateSeverity(kind: ServiceStateKind, share: number | null): SeverityCode {
	if (share == null) return 'watch';
	if (kind === 'delivered') return 'watch';
	if (share >= 10) return 'critical';
	if (share >= 5) return 'high';
	return 'watch';
}

function share(
	count: number | null | undefined,
	scheduled: number | null | undefined,
): number | null {
	if (count == null || scheduled == null || scheduled <= 0) return null;
	return (count / scheduled) * 100;
}

export function selectStateCuts(
	states: ReceiptServiceStates | null | undefined,
	labels: StateCutsLabels,
): StateCutsVM {
	const scheduled = states?.scheduled_trip_days ?? null;
	const deliveredShare = share(states?.delivered_trip_days, scheduled);
	const cancelledShare = share(states?.cancelled_trip_days, scheduled);
	const silentShare = share(states?.silent_trip_days, scheduled);

	const rows: StateCutRow[] = (
		[
			['delivered', labels.delivered, deliveredShare],
			['cancelled', labels.cancelled, cancelledShare],
			['silent', labels.silent, silentShare],
		] as const
	).map(([key, label, value]) => ({
		key,
		label,
		severity: stateSeverity(key, value),
		value,
		domain: CANCEL_RATE_DOMAIN,
		display: labels.fmtSharePct(value),
	}));

	const completeness = states?.service_completeness_pct ?? null;
	const hasData = completeness != null || rows.some((r) => r.value != null);

	return {
		completeness,
		completenessDisplay: labels.fmtSharePct(completeness),
		rows,
		hasData,
	};
}
