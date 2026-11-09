import type { Vehicle } from '#lib/v1/schemas/index.ts';

export function isInService(vehicle: Pick<Vehicle, 'trip'>): boolean {
	return vehicle.trip != null && vehicle.trip !== '';
}

export function outOfServiceCount(vehicles: readonly Vehicle[]): number {
	return vehicles.filter((vehicle) => !isInService(vehicle)).length;
}

export const vehicleServiceCopy = {
	en: { status: 'Out of service', count: 'Out-of-service vehicles:' },
	fr: { status: 'Hors service', count: 'Véhicules hors service\u202f:' },
} as const;
