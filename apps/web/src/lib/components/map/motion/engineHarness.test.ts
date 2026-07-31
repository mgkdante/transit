import { afterEach, describe, expect, it } from 'vitest';

import type { Map as MapLibreMap } from 'maplibre-gl';
import {
	createVehicleMotionController,
	type FixResolver,
	type MotionRuntime,
	type ShapeResolver,
	type VehicleFix,
	type VehicleMotionController,
} from '../vehicleMotion';
import { VEHICLE_SOURCE, type VehicleFC, type VehicleFeature } from '../vehicleLayer';
import { type Coord } from '../polyline';
import { BLEND_MS } from './constants';
import { STALE_CUTOFF_S } from '../vehicleProjection';

const RAF_HZ = 60;
// This epsilon is still 60 Hz for any meaningful clock resolution, but avoids the
// floating-point equality trap between 2 * (1000 / 60) and MIN_RENDER_INTERVAL_MS.
const FRAME_MS = 1000 / RAF_HZ + 1e-9;
const EXPECTED_EVALUATIONS_PER_SECOND = 30;
const MEASURE_SECONDS = 3;
const EXPECTED_QUANTIZED_DUPLICATE_RATE = 0.967;
const QUANTIZED_DUPLICATE_TOLERANCE = 0.015;
const MIN_CONTINUOUS_POSITIONS_PER_SECOND = 25;
const MIN_CONTINUOUS_STEP_M = 0.1;
const MAX_CONTINUOUS_STEP_M = 0.6;

const SERVER_EPOCH_MS = Date.parse('2026-07-31T16:00:00.000Z');
const M_PER_DEG_LAT = 111_320;
const REF_LAT = 45.5;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((REF_LAT * Math.PI) / 180);
const MOVING_ID = 'moving';
const STATIONARY_ID = 'stationary';
const STALE_BOUNDARY_ID = 'stale-boundary';
const PINNED_ID = 'pinned';
const WEST = [-73.7, REF_LAT] as Coord;
const EAST = [-73.4, REF_LAT] as Coord;
const EASTBOUND_SHAPE: readonly Coord[] = [WEST, EAST];
const MOVING_SPEED_MPS = 30 / 3.6;

interface EvaluationSample {
	elapsedMs: number;
	signature: string;
	coord: Coord;
	staleProbe: number;
}

interface UploadEvent {
	elapsedMs: number;
	fc: VehicleFC;
}

interface EngineMetrics {
	evaluations: number;
	uploads: number;
	skips: number;
	consecutiveDuplicates: number;
	duplicateRate: number;
	positionsPerSecond: number[];
	stepDistancesM: number[];
	staleStates: number[];
}

interface MeasurementWindow {
	vehicleId: string;
	startElapsedMs: number;
	durationSeconds: number;
	startUploadIndex: number;
	samples: EvaluationSample[];
}

interface ControlledEngine {
	controller: VehicleMotionController;
	serverNowFn: () => number;
	feed(tick: TickFixture): void;
	driveFrames(count: number): void;
	beginMeasurement(vehicleId: string, durationSeconds: number): void;
	finishMeasurement(): EngineMetrics;
	latestFeature(id: string): VehicleFeature;
	hasPending(): boolean;
	destroy(): void;
}

interface TickFixture {
	tickKey: string;
	updatedUtc: string;
	reportedById: ReadonlyMap<string, string>;
	fc: VehicleFC;
	fixFor: FixResolver;
	shapeFor: ShapeResolver;
}

const liveControllers = new Set<VehicleMotionController>();

afterEach(() => {
	for (const controller of liveControllers) controller.destroy();
	liveControllers.clear();
});

function iso(epochMs: number): string {
	return new Date(epochMs).toISOString();
}

function lonAfterMetres(lon: number, metres: number): number {
	return lon + metres / M_PER_DEG_LON;
}

function featureAt(id: string, coord: Coord, bearing = 90): VehicleFeature {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: coord },
		properties: {
			id,
			body: 'bus',
			bearing,
			hasHeading: 1,
			route: '161',
			selected: 0,
			matched: 1,
			stale: 0,
		},
	};
}

function cloneFc(fc: VehicleFC): VehicleFC {
	return structuredClone(fc);
}

function signatureFor(fc: VehicleFC): string {
	return JSON.stringify(
		fc.features.map((feature) => [
			feature.properties.id,
			feature.geometry.coordinates[0],
			feature.geometry.coordinates[1],
			feature.properties.bearing,
			feature.properties.stale,
		]),
	);
}

function featureById(fc: VehicleFC, id: string): VehicleFeature {
	const feature = fc.features.find((candidate) => candidate.properties.id === id);
	if (!feature) throw new Error(`Missing vehicle ${id}`);
	return feature;
}

function planarDistanceM(a: Coord, b: Coord): number {
	const meanLatRad = (((a[1] + b[1]) / 2) * Math.PI) / 180;
	const x = (b[0] - a[0]) * M_PER_DEG_LAT * Math.cos(meanLatRad);
	const y = (b[1] - a[1]) * M_PER_DEG_LAT;
	return Math.hypot(x, y);
}

function duplicateCount(signatures: readonly string[]): number {
	let duplicates = 0;
	for (let index = 1; index < signatures.length; index += 1) {
		if (signatures[index] === signatures[index - 1]) duplicates += 1;
	}
	return duplicates;
}

function reportMetrics(label: string, metrics: EngineMetrics): void {
	if (process.env.M2B_HARNESS_REPORT !== '1') return;
	const stepMinM = metrics.stepDistancesM.length ? Math.min(...metrics.stepDistancesM) : 0;
	const stepMaxM = metrics.stepDistancesM.length ? Math.max(...metrics.stepDistancesM) : 0;
	console.info(
		`${label} ${JSON.stringify({
			evaluations: metrics.evaluations,
			uploads: metrics.uploads,
			skips: metrics.skips,
			consecutiveDuplicates: metrics.consecutiveDuplicates,
			duplicateRate: metrics.duplicateRate,
			positionsPerSecond: metrics.positionsPerSecond,
			stepMinM,
			stepMaxM,
			staleStates: [...new Set(metrics.staleStates)],
		})}`,
	);
}

function createControlledEngine(quantizeMs: number): ControlledEngine {
	let elapsedMs = 0;
	let pending: (() => void) | null = null;
	let nextHandle = 0;
	let evaluationCount = 0;
	let latestFc: VehicleFC | null = null;
	let measurement: MeasurementWindow | null = null;
	const uploads: UploadEvent[] = [];

	const runtime: MotionRuntime = {
		now: () => elapsedMs,
		requestFrame: (callback) => {
			pending = callback;
			return ++nextHandle;
		},
		cancelFrame: () => {
			pending = null;
		},
	};

	const serverNowFn = () => {
		evaluationCount += 1;
		const serverElapsed =
			quantizeMs > 0 ? Math.floor(elapsedMs / quantizeMs) * quantizeMs : elapsedMs;
		return SERVER_EPOCH_MS + serverElapsed;
	};

	const setData = (data: unknown) => {
		latestFc = cloneFc(data as VehicleFC);
		uploads.push({ elapsedMs, fc: latestFc });
	};
	const map = {
		getSource: (id: string) => (id === VEHICLE_SOURCE ? { setData } : undefined),
	} as unknown as MapLibreMap;
	const controller = createVehicleMotionController(map, runtime);
	liveControllers.add(controller);

	function requireLatestFc(): VehicleFC {
		if (!latestFc) throw new Error('The controller has not uploaded a FeatureCollection');
		return latestFc;
	}

	function observeEvaluation(): void {
		if (!measurement) return;
		const fc = requireLatestFc();
		const vehicle = featureById(fc, measurement.vehicleId);
		const staleProbe =
			fc.features.find((feature) => feature.properties.id === STALE_BOUNDARY_ID) ?? vehicle;
		measurement.samples.push({
			elapsedMs,
			signature: signatureFor(fc),
			coord: vehicle.geometry.coordinates as Coord,
			staleProbe: staleProbe.properties.stale,
		});
	}

	function driveOneFrame(): void {
		elapsedMs += FRAME_MS;
		const evaluationsBefore = evaluationCount;
		const callback = pending;
		pending = null;
		callback?.();
		const evaluationsAfter = evaluationCount;
		if (evaluationsAfter - evaluationsBefore > 1) {
			throw new Error('A single rAF unexpectedly evaluated the engine more than once');
		}
		if (evaluationsAfter > evaluationsBefore) observeEvaluation();
	}

	return {
		controller,
		serverNowFn,
		feed(tick) {
			controller.set(tick.fc, {
				tickKey: tick.tickKey,
				animate: true,
				stale: false,
				fixFor: tick.fixFor,
				shapeFor: tick.shapeFor,
				serverNowFn,
			});
		},
		driveFrames(count) {
			for (let frame = 0; frame < count; frame += 1) driveOneFrame();
		},
		beginMeasurement(vehicleId, durationSeconds) {
			if (measurement) throw new Error('A measurement window is already active');
			measurement = {
				vehicleId,
				startElapsedMs: elapsedMs,
				durationSeconds,
				startUploadIndex: uploads.length,
				samples: [],
			};
		},
		finishMeasurement() {
			if (!measurement) throw new Error('No measurement window is active');
			const completed = measurement;
			measurement = null;
			const signatures = completed.samples.map((sample) => sample.signature);
			const consecutiveDuplicates = duplicateCount(signatures);
			const comparisonCount = Math.max(0, signatures.length - 1);
			const positions = Array.from({ length: completed.durationSeconds }, () => new Set<string>());
			for (const sample of completed.samples) {
				const relativeMs = sample.elapsedMs - completed.startElapsedMs;
				const bucket = Math.min(
					completed.durationSeconds - 1,
					Math.max(0, Math.ceil(relativeMs / 1000) - 1),
				);
				positions[bucket].add(`${sample.coord[0]},${sample.coord[1]}`);
			}
			const stepDistancesM: number[] = [];
			for (let index = 1; index < completed.samples.length; index += 1) {
				stepDistancesM.push(
					planarDistanceM(completed.samples[index - 1].coord, completed.samples[index].coord),
				);
			}
			const uploadCount = uploads.length - completed.startUploadIndex;
			return {
				evaluations: completed.samples.length,
				uploads: uploadCount,
				skips: completed.samples.length - uploadCount,
				consecutiveDuplicates,
				duplicateRate: comparisonCount === 0 ? 0 : consecutiveDuplicates / comparisonCount,
				positionsPerSecond: positions.map((bucket) => bucket.size),
				stepDistancesM,
				staleStates: completed.samples.map((sample) => sample.staleProbe),
			};
		},
		latestFeature(id) {
			return featureById(requireLatestFc(), id);
		},
		hasPending() {
			return pending != null;
		},
		destroy() {
			controller.destroy();
			liveControllers.delete(controller);
		},
	};
}

function continuityTick(tickIndex: 0 | 1): TickFixture {
	const generatedEpochMs = SERVER_EPOCH_MS + tickIndex * 1000;
	const generatedUtc = iso(generatedEpochMs);
	const movingReportedUtc = iso(generatedEpochMs - 5000);
	const stationaryReportedUtc = iso(generatedEpochMs - 1000);
	const staleReportedUtc = iso(generatedEpochMs - (STALE_CUTOFF_S * 1000 - 2500));
	const movingCoord = [lonAfterMetres(WEST[0], MOVING_SPEED_MPS * tickIndex), WEST[1]] as Coord;
	const fixes = new Map<string, VehicleFix>([
		[
			MOVING_ID,
			{
				reportedUtc: movingReportedUtc,
				updatedUtc: generatedUtc,
				speedMps: MOVING_SPEED_MPS,
			},
		],
		[
			STATIONARY_ID,
			{
				reportedUtc: stationaryReportedUtc,
				updatedUtc: generatedUtc,
				speedMps: 0,
			},
		],
		[STALE_BOUNDARY_ID, { reportedUtc: staleReportedUtc, updatedUtc: generatedUtc, speedMps: 0 }],
	]);
	const reportedById = new Map<string, string>([
		[MOVING_ID, movingReportedUtc],
		[STATIONARY_ID, stationaryReportedUtc],
		[STALE_BOUNDARY_ID, staleReportedUtc],
	]);
	return {
		tickKey: generatedUtc,
		updatedUtc: generatedUtc,
		reportedById,
		fc: {
			type: 'FeatureCollection',
			features: [
				featureAt(MOVING_ID, movingCoord),
				featureAt(STATIONARY_ID, [-73.65, 45.505], 0),
				featureAt(STALE_BOUNDARY_ID, [-73.66, 45.51], 180),
			],
		},
		fixFor: (id) => fixes.get(id) ?? null,
		shapeFor: (vehicle) => (vehicle.properties.id === MOVING_ID ? EASTBOUND_SHAPE : null),
	};
}

function pinnedTick(tickIndex: 0 | 1): TickFixture {
	const generatedEpochMs = SERVER_EPOCH_MS + tickIndex * 1000;
	const generatedUtc = iso(generatedEpochMs);
	const reportedUtc = iso(generatedEpochMs - 1000);
	const fix: VehicleFix = {
		reportedUtc,
		updatedUtc: generatedUtc,
		speedMps: 0,
	};
	return {
		tickKey: generatedUtc,
		updatedUtc: generatedUtc,
		reportedById: new Map([[PINNED_ID, reportedUtc]]),
		fc: {
			type: 'FeatureCollection',
			features: [featureAt(PINNED_ID, [-73.65, 45.505], 0)],
		},
		fixFor: () => fix,
		shapeFor: () => null,
	};
}

function expectAllThreeUtcStampsAdvanced(first: TickFixture, second: TickFixture): void {
	expect(Date.parse(second.tickKey) - Date.parse(first.tickKey)).toBe(1000);
	expect(Date.parse(second.updatedUtc) - Date.parse(first.updatedUtc)).toBe(1000);
	for (const [id, firstReportedUtc] of first.reportedById) {
		const secondReportedUtc = second.reportedById.get(id);
		expect(secondReportedUtc, `missing second-tick reportedUtc for ${id}`).toBeDefined();
		expect(Date.parse(secondReportedUtc!) - Date.parse(firstReportedUtc)).toBe(1000);
	}
}

function runContinuityFixture(quantizeMs: number): EngineMetrics {
	const engine = createControlledEngine(quantizeMs);
	const first = continuityTick(0);
	const second = continuityTick(1);
	expectAllThreeUtcStampsAdvanced(first, second);

	engine.feed(first);
	expect(engine.hasPending()).toBe(true);
	expect(engine.latestFeature(MOVING_ID).properties.stale).toBe(0);
	expect(engine.latestFeature(MOVING_ID).geometry.coordinates[0]).toBeGreaterThan(WEST[0]);
	engine.driveFrames(RAF_HZ);

	engine.feed(second);
	expect(engine.hasPending()).toBe(true);
	expect(engine.latestFeature(MOVING_ID).properties.stale).toBe(0);
	engine.driveFrames(Math.ceil((BLEND_MS / 1000) * RAF_HZ) + 6);

	engine.beginMeasurement(MOVING_ID, MEASURE_SECONDS);
	engine.driveFrames(RAF_HZ * MEASURE_SECONDS);
	const metrics = engine.finishMeasurement();
	engine.destroy();
	return metrics;
}

function runStationarySkipFixture(): EngineMetrics {
	const engine = createControlledEngine(0);
	const first = pinnedTick(0);
	const second = pinnedTick(1);
	expectAllThreeUtcStampsAdvanced(first, second);

	engine.feed(first);
	engine.driveFrames(RAF_HZ);
	engine.feed(second);
	engine.driveFrames(Math.ceil((BLEND_MS / 1000) * RAF_HZ) + 6);
	expect(engine.latestFeature(PINNED_ID).properties.stale).toBe(0);
	expect(engine.hasPending()).toBe(true);

	engine.beginMeasurement(PINNED_ID, MEASURE_SECONDS);
	engine.driveFrames(RAF_HZ * MEASURE_SECONDS);
	const metrics = engine.finishMeasurement();
	engine.destroy();
	return metrics;
}

describe('motion engine deterministic acceptance harness', () => {
	it('self-calibrates the former 1 Hz server clock as ~96.9% duplicate evaluations', () => {
		const metrics = runContinuityFixture(1000);
		reportMetrics('before-quantized', metrics);

		expect(metrics.evaluations).toBe(EXPECTED_EVALUATIONS_PER_SECOND * MEASURE_SECONDS);
		expect(metrics.uploads + metrics.skips).toBe(metrics.evaluations);
		expect(Math.abs(metrics.duplicateRate - EXPECTED_QUANTIZED_DUPLICATE_RATE)).toBeLessThanOrEqual(
			QUANTIZED_DUPLICATE_TOLERANCE,
		);
		expect(metrics.positionsPerSecond.every((count) => count >= 1 && count <= 2)).toBe(true);
		expect(metrics.staleStates).toContain(0);
		expect(metrics.staleStates).toContain(1);
	});

	it('produces continuous moving positions after correction blending with the live clock', () => {
		const metrics = runContinuityFixture(0);
		reportMetrics('after-continuous', metrics);

		expect(metrics.evaluations).toBe(EXPECTED_EVALUATIONS_PER_SECOND * MEASURE_SECONDS);
		expect(metrics.uploads + metrics.skips).toBe(metrics.evaluations);
		expect(metrics.consecutiveDuplicates).toBe(0);
		expect(metrics.duplicateRate).toBe(0);
		expect(
			metrics.positionsPerSecond.every((count) => count >= MIN_CONTINUOUS_POSITIONS_PER_SECOND),
		).toBe(true);
		expect(metrics.stepDistancesM.length).toBe(metrics.evaluations - 1);
		expect(
			metrics.stepDistancesM.every(
				(distance) => distance >= MIN_CONTINUOUS_STEP_M && distance <= MAX_CONTINUOUS_STEP_M,
			),
		).toBe(true);
		expect(metrics.staleStates).toContain(0);
		expect(metrics.staleStates).toContain(1);
	});

	it('attributes every stationary evaluated-frame suppression to the dirty-check', () => {
		const metrics = runStationarySkipFixture();
		reportMetrics('after-stationary', metrics);

		expect(metrics.evaluations).toBe(EXPECTED_EVALUATIONS_PER_SECOND * MEASURE_SECONDS);
		expect(metrics.uploads).toBe(0);
		expect(metrics.skips).toBe(metrics.evaluations);
		expect(metrics.consecutiveDuplicates).toBe(metrics.evaluations - 1);
		expect(metrics.positionsPerSecond).toEqual([1, 1, 1]);
		expect(metrics.stepDistancesM.every((distance) => distance === 0)).toBe(true);
		expect(new Set(metrics.staleStates)).toEqual(new Set([0]));
	});
});
