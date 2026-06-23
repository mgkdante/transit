// map/motion/projector.ts — per-vehicle frame projection (pure).
//
// Given one vehicle's latest fix + an optional ease-correct blend, compute its
// displayed position/heading at a server-clock instant. Composes the pure easing
// math with vehicleProjection's forward dead-reckoning. No GL, no scheduler.

import type { VehicleFeature } from '../vehicleLayer';
import type { Coord } from '../polyline';
import { fixAgeS, projectVehicle, type ProjectVehicleResult } from '../vehicleProjection';
import { BLEND_MS } from './constants';
import { blendBearing, normalizeBearing, power1Out, roundCoordinate } from './easing';

/**
 * Per-vehicle inputs the FORWARD projection needs that are NOT carried on the GL
 * feature itself: the bus's OWN fix time (`reported_utc`, nullable → fall back to
 * the uniform snapshot `updated_utc`) and its speed in metres/second. Supplied by
 * MapHero alongside the feature collection so the controller can dead-reckon each
 * bus off its own latest fix without polluting the painted feature's typed props.
 */
export interface VehicleFix {
	/** The bus's OWN GTFS-RT fix time (ISO 8601), or null/undefined. */
	reportedUtc: string | null | undefined;
	/** The uniform snapshot capture time (ISO 8601) — the fallback for age. */
	updatedUtc: string;
	/** Reported speed in metres/second (≤ 0 or null → freeze, no dead-reckon). */
	speedMps: number | null;
}

/** Look up a vehicle's projection inputs by id. Returns null when unknown (the
 *  controller then freezes that bus at its reported position — never projects on
 *  guessed data). */
export type FixResolver = (id: string) => VehicleFix | null;

/**
 * Resolve a vehicle's route SHAPE (an ordered lon/lat polyline) so the projection
 * can advance ALONG the street it is on. Returns null when no shape is loaded for
 * that vehicle's route — the bus then FREEZES at its fix (we never dead-reckon on
 * the raw GTFS-RT bearing, which is not guaranteed route-aligned). Keyed by the
 * VehicleFeature (it carries `route` + `id`). Read EACH FRAME (cheap: a cache
 * lookup) so a route shape that resolves mid-flight upgrades the bus to projection
 * without a re-feed.
 */
export type ShapeResolver = (feature: VehicleFeature) => readonly Coord[] | null;

/**
 * Per-vehicle ease-correct state captured when a fresh fix arrives: the displayed
 * position/heading at that instant (the blend ORIGIN) + the wall-clock start. The
 * blend runs from this origin to the live projection over BLEND_MS.
 */
export interface BlendState {
	fromCoord: Coord;
	fromBearing: number;
	startMs: number;
}

/**
 * A latest fix for one vehicle: the painted feature (display props + last reported
 * coord/bearing) plus the projection inputs. The feature's geometry is the bus's
 * REPORTED position; the displayed position is computed each frame by projecting
 * forward from it.
 */
export interface VehicleEntry {
	feature: VehicleFeature;
	fix: VehicleFix | null;
}

/**
 * Project ONE vehicle to its displayed position+heading at `serverNow`, blended
 * from its ease-correct origin if a correction is in flight. Pure given its inputs.
 *
 * The projection is FORWARD dead-reckoning (vehicleProjection.projectVehicle): from
 * the bus's reported coord, advance along the route shape by the decaying-speed
 * distance for its fix age. Frozen (stale / no shape / no speed) → the reported
 * coord + reported bearing. The blend (`e = power1Out(elapsed/BLEND_MS)`) lerps the
 * displayed dot from where it was when the fix landed to this projection, so a
 * corrected position eases in rather than snapping.
 */
export function projectEntry(
	entry: VehicleEntry,
	serverNow: number,
	nowMs: number,
	shapeFor: ShapeResolver | undefined,
	blend: BlendState | undefined,
): { feature: VehicleFeature; result: ProjectVehicleResult } {
	const { feature, fix } = entry;
	const coord = feature.geometry.coordinates as Coord;
	const shape = shapeFor?.(feature) ?? null;
	const ageS = fix ? fixAgeS(fix.reportedUtc, fix.updatedUtc, serverNow) : Infinity;

	const result = projectVehicle({
		coord,
		shape,
		speedMps: fix?.speedMps ?? null,
		ageS,
		bearing: feature.properties.bearing,
	});

	let lon = result.coord[0];
	let lat = result.coord[1];
	let bearing = Math.round(normalizeBearing(result.bearing));

	if (blend) {
		const e = power1Out((nowMs - blend.startMs) / BLEND_MS);
		lon = blend.fromCoord[0] + (lon - blend.fromCoord[0]) * e;
		lat = blend.fromCoord[1] + (lat - blend.fromCoord[1]) * e;
		bearing = blendBearing(blend.fromBearing, bearing, e);
	}

	return {
		feature: {
			...feature,
			geometry: { type: 'Point', coordinates: [roundCoordinate(lon), roundCoordinate(lat)] },
			// Re-stamp the per-bus stale flag from the LIVE projection so a bus that
			// crosses the cutoff between polls gets its "!" the moment it goes stale —
			// the controller owns the freeze flag off the live clock, no re-feed needed.
			properties: { ...feature.properties, bearing, stale: result.stale ? 1 : 0 },
		},
		result,
	};
}
