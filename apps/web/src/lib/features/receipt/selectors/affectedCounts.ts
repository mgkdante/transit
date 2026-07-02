// affectedCounts — the receipt's affected-count cells (S13).
//
// Ports the AccountabilityReceipt `countCell` inputs into a PURE presenter: the
// routes / stops / alerts touched on the day, each a MaybeValue-ready VM (null →
// the styled 'no-observations' chip, a real measured 0 stays a real 0). `vehicles`
// is structurally always-null on /v1 (the daily receipt carries no per-vehicle
// count), so the cell is OMITTED from the VM entirely unless a real count surfaces —
// never a permanent honest-absence row.

import type { Receipt } from '$lib/v1/schemas';

/** One affected-count cell VM (MaybeValue-ready — null value → the styled chip). */
export interface AffectedCountVM {
	readonly key: 'routes' | 'stops' | 'alerts' | 'vehicles';
	readonly label: string;
	/** Formatted count, or null → the styled honest-absence chip. */
	readonly value: string | null;
}

export interface AffectedCountLabels {
	readonly routes: string;
	readonly stops: string;
	readonly alerts: string;
	readonly vehicles: string;
	/** "1,234" (localized thousands) or null. */
	readonly fmtCount: (v: number | null | undefined) => string | null;
}

/** Build the affected-count VMs. `vehicles` surfaces only when a real count exists. */
export function selectAffectedCounts(
	receipt: Pick<Receipt, 'affected_routes' | 'affected_stops' | 'alerts' | 'vehicles'>,
	labels: AffectedCountLabels,
): AffectedCountVM[] {
	const cells: AffectedCountVM[] = [
		{ key: 'routes', label: labels.routes, value: labels.fmtCount(receipt.affected_routes) },
		{ key: 'stops', label: labels.stops, value: labels.fmtCount(receipt.affected_stops) },
		{ key: 'alerts', label: labels.alerts, value: labels.fmtCount(receipt.alerts) },
	];
	// `vehicles` is structurally always-null on /v1 → the cell is dropped rather than a
	// permanent no-data row. A real count would surface it again.
	if (receipt.vehicles != null) {
		cells.push({
			key: 'vehicles',
			label: labels.vehicles,
			value: labels.fmtCount(receipt.vehicles),
		});
	}
	return cells;
}
