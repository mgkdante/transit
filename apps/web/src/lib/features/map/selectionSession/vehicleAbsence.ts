import { notReporting } from '../vehicleMotion';
import type { MapSelectionDetail } from './mapSelection';

export function vehicleAbsence(
	detail: MapSelectionDetail | null,
	serverNow: number,
): { ageS: number } | null {
	if (detail?.kind !== 'vehicle') return null;
	return notReporting(detail.vehicle, serverNow);
}
