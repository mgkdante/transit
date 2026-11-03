import { fixAgeS, isVehicleStale } from '$lib/components/map';
import type { MapSelectionDetail } from './mapSelection';

export function vehicleAbsence(
	detail: MapSelectionDetail | null,
	serverNow: number,
): { ageS: number } | null {
	if (detail?.kind !== 'vehicle') return null;
	const ageS = fixAgeS(detail.vehicle.reported_utc, detail.vehicle.updated_utc, serverNow);
	return isVehicleStale(ageS) ? { ageS } : null;
}
