// stateCuts — the receipt's scheduled→delivered→cancelled→silent split (S13, NEW).
//
// Consumes Receipt.service_states (GC2's scheduled/delivered/cancelled/silent trip-day
// counts + the ONE completeness number, service_completeness_pct). Presents the day's
// service-state cuts as share bars on the FIXED absolute [0,100] whole (CANCEL_RATE_DOMAIN
// family — a share of scheduled trips, never the in-view max). The completeness figure is
// HEROED from service_states.service_completeness_pct (DB1: one name per number — there is
// no duplicate top-level scalar); the delivered/cancelled/silent shares are computed from
// the trip-day counts over the scheduled denominator.
//
// HONEST RAMP-IN (WEB4 · S9 completeness family): service_states is additive-optional and
// null across the retained window until GC2's scheduled-universe data accrues. So the VM
// stands the whole section DOWN (hasData=false) unless the completeness number OR a
// computed share is real — never a fabricated 0, never an empty "every trip delivered" card.
// A silent trip is scheduled but never appears in the live feed (distinct from an explicit
// cancellation) — that framing is COPY reused from the S9 completeness family.

import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/domains';
import type { ReceiptServiceStates, SeverityCode } from '$lib/v1/schemas';

/** The state-cut kinds, in the canonical scheduled→delivered→cancelled→silent order. */
export type ServiceStateKind = 'delivered' | 'cancelled' | 'silent';

/** One state-cut share row (a share of scheduled trips on the absolute [0,100] whole). */
export interface StateCutRow {
	readonly key: ServiceStateKind;
	readonly label: string;
	readonly severity: SeverityCode;
	/** The share (%) on CANCEL_RATE_DOMAIN, or null when the denominator is absent. */
	readonly value: number | null;
	readonly domain: readonly [number, number];
	/** Formatted "82.0%" display, or null → the styled honest-absence chip. */
	readonly display: string | null;
}

export interface StateCutsVM {
	/** The heroed completeness reading (%), or null → the honest-absence chip. */
	readonly completeness: number | null;
	/** Formatted completeness ("80.0%"), or null. */
	readonly completenessDisplay: string | null;
	/** The delivered / cancelled / silent share rows. */
	readonly rows: StateCutRow[];
	/**
	 * True when the completeness number OR any computed share is real. False → the
	 * whole section stands down behind the honest-absence layer (GC2 ramp-in).
	 */
	readonly hasData: boolean;
}

export interface StateCutsLabels {
	readonly delivered: string;
	readonly cancelled: string;
	readonly silent: string;
	/** "80.0%" or null (fixed-1 share). */
	readonly fmtSharePct: (v: number | null) => string | null;
}

/** Severity banding: delivered is calm (green), a cancelled/silent gap reads hot. */
function stateSeverity(kind: ServiceStateKind, share: number | null): SeverityCode {
	if (share == null) return 'watch';
	if (kind === 'delivered') return 'watch'; // a delivered share is the GOOD reading — never hot
	// A cancelled/silent gap: >=10% critical, >=5% high, else watch (mirrors the severe bands).
	if (share >= 10) return 'critical';
	if (share >= 5) return 'high';
	return 'watch';
}

/** Compute a state's share of the scheduled denominator, or null when unusable. */
function share(
	count: number | null | undefined,
	scheduled: number | null | undefined,
): number | null {
	if (count == null || scheduled == null || scheduled <= 0) return null;
	return (count / scheduled) * 100;
}

/** Build the state-cuts VM from Receipt.service_states. */
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
