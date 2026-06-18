import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '$lib/motion/policy';
import { gsap } from '$lib/motion/utils/gsap';
import { VEHICLE_SOURCE, type VehicleFC, type VehicleFeature } from './vehicleLayer';

export interface VehicleMotionOptions {
	tickKey?: string | null;
	stale?: boolean;
	durationSec?: number;
	animate?: boolean;
}

export interface VehicleMotionController {
	set(features: VehicleFC, options?: VehicleMotionOptions): void;
	destroy(): void;
}

type Progress = { value: number };

const DEFAULT_DURATION_SEC = 28;

function clamp01(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
}

function roundCoordinate(value: number): number {
	return Number(value.toFixed(6));
}

function normalizeBearing(value: number): number {
	return ((value % 360) + 360) % 360;
}

function interpolateBearing(from: number, to: number, t: number): number {
	const delta = ((to - from + 540) % 360) - 180;
	return Math.round(normalizeBearing(from + delta * t));
}

function interpolateFeature(
	from: VehicleFeature | undefined,
	to: VehicleFeature,
	t: number,
): VehicleFeature {
	if (!from) return to;
	const [fromLon, fromLat] = from.geometry.coordinates;
	const [toLon, toLat] = to.geometry.coordinates;

	return {
		...to,
		geometry: {
			type: 'Point',
			coordinates: [
				roundCoordinate(fromLon + (toLon - fromLon) * t),
				roundCoordinate(fromLat + (toLat - fromLat) * t),
			],
		},
		properties: {
			...to.properties,
			bearing: interpolateBearing(from.properties.bearing, to.properties.bearing, t),
		},
	};
}

export function interpolateVehicleFeatures(
	from: VehicleFC,
	to: VehicleFC,
	progress: number,
): VehicleFC {
	const t = clamp01(progress);
	const previousById = new Map(from.features.map((feature) => [feature.properties.id, feature]));

	return {
		type: 'FeatureCollection',
		features: to.features.map((feature) =>
			interpolateFeature(previousById.get(feature.properties.id), feature, t),
		),
	};
}

function setVehicleSourceData(map: MapLibreMap, features: VehicleFC): void {
	const source = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
	source?.setData(features as unknown as Parameters<GeoJSONSource['setData']>[0]);
}

export function createVehicleMotionController(map: MapLibreMap): VehicleMotionController {
	let current: VehicleFC | null = null;
	let from: VehicleFC | null = null;
	let target: VehicleFC | null = null;
	let tickKey: string | null = null;
	let tween: gsap.core.Tween | null = null;
	const progress: Progress = { value: 0 };

	function stopTween(): void {
		tween?.kill();
		tween = null;
	}

	function snap(next: VehicleFC, nextTickKey: string | null): void {
		stopTween();
		current = next;
		from = next;
		target = next;
		tickKey = nextTickKey;
		progress.value = 1;
		setVehicleSourceData(map, next);
	}

	function render(): void {
		if (!from || !target) return;
		current = interpolateVehicleFeatures(from, target, progress.value);
		setVehicleSourceData(map, current);
	}

	return {
		set(next: VehicleFC, options: VehicleMotionOptions = {}) {
			const nextTickKey = options.tickKey ?? null;
			const animate = options.animate ?? shouldAnimate('motion-gated');

			if (options.stale || !animate || !current) {
				snap(next, nextTickKey);
				return;
			}

			if (nextTickKey === tickKey) {
				target = next;
				if (tween) render();
				else snap(next, nextTickKey);
				return;
			}

			stopTween();
			from = current;
			target = next;
			tickKey = nextTickKey;
			progress.value = 0;

			tween = gsap.to(progress, {
				value: 1,
				duration: options.durationSec ?? DEFAULT_DURATION_SEC,
				ease: 'none',
				onUpdate: render,
				onComplete: () => snap(next, nextTickKey),
			});
		},
		destroy() {
			stopTween();
		},
	};
}
