import type { Vehicle, VehiclesFile, RouteFile } from '#lib/v1/schemas/index.ts';
import type { FilterState } from '#lib/filters/index.ts';
import { toVehicleFeatures } from '#lib/components/map/index.ts';
import type { VehicleMotionController } from '#lib/components/map/motion/controller.ts';
import { createShapeCacheManager } from './mapShapeCache';
import { projectionHorizon } from '#lib/components/map/vehicleProjection.ts';

export { notReporting } from '#lib/components/map/vehicleProjection.ts';

export interface MotionIntent {
	preference: 'raw' | 'smooth';
	reducedMotion: boolean;
	ready: boolean;
	stale: boolean;
	ttlS?: number;
	stops?: readonly { id: string; lon: number; lat: number }[];
}

export interface VehicleMotionFrame {
	readonly items: readonly Vehicle[];
	readonly tickKey: string | null;
	readonly stale: boolean;
	readonly motionKey: boolean;
	draw(
		controller: VehicleMotionController,
		filter: FilterState,
		alerts: ReadonlySet<string> | undefined,
		selected: string | null | undefined,
	): void;
}

// The map runtime owns the overlay lifetime; this module owns what it draws.
export function createVehicleMotion(
	getRoute: (id: string) => Promise<RouteFile | null>,
	clock: { now(): number; continuous(): number },
) {
	const shapes = createShapeCacheManager(getRoute);
	return {
		remember: shapes.remember,
		read(snapshot: VehiclesFile | null | undefined, intent: MotionIntent): VehicleMotionFrame {
			const items = snapshot?.vehicles ?? [];
			if (intent.preference === 'smooth') shapes.prefetch(items);
			const animate = intent.preference === 'smooth' && !intent.reducedMotion && intent.ready;
			const byId = new Map(items.map((vehicle) => [vehicle.id, vehicle]));
			const stops = new Map(intent.stops?.map((stop) => [stop.id, [stop.lon, stop.lat] as const]));
			return {
				items,
				tickKey: snapshot?.generated_utc ?? null,
				stale: intent.stale,
				motionKey: animate,
				draw(controller, filter, alerts, selected) {
					const serverNow = clock.now();
					controller.set(toVehicleFeatures(items, filter, alerts, selected, { serverNow }), {
						tickKey: snapshot?.generated_utc ?? null,
						stale: intent.stale,
						animate,
						shapeFor: animate ? shapes.shapeFor : undefined,
						subscribeShapes: animate ? shapes.subscribe : undefined,
						serverNowFn: clock.continuous,
						fixFor(id) {
							const vehicle = byId.get(id);
							return vehicle
								? {
										reportedUtc: vehicle.reported_utc,
										updatedUtc: vehicle.updated_utc,
										speedMps: vehicle.speed_kmh != null ? vehicle.speed_kmh / 3.6 : null,
										horizon: projectionHorizon(intent.ttlS),
										nextStop: vehicle.next_stop ? stops.get(vehicle.next_stop) : null,
									}
								: null;
						},
					});
				},
			};
		},
	};
}
