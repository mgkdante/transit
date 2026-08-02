import { SvelteMap } from 'svelte/reactivity';

const BASE_TIME = Date.parse('2026-06-20T12:00:30Z');
const BASE_GENERATION = '2026-06-20T12:00:00Z';

let serverNow = $state(BASE_TIME);
let vehiclesGeneration = $state(BASE_GENERATION);
let currentMotionMode = $state<'raw' | 'smooth'>('raw');

export interface MapHeroFeatureStateEvent {
	readonly operation: 'set' | 'remove';
	readonly target: { readonly source: string; readonly id: string | number };
	readonly state?: Readonly<Record<string, boolean>>;
	readonly property?: string;
}

let featureStateEvents: MapHeroFeatureStateEvent[] = [];
let featureStateObserver: ((event: MapHeroFeatureStateEvent) => void) | null = null;
let mapStageSequence = 0;
const mapStageListenerCounts = new SvelteMap<number, Record<string, number>>();
const mapStageSourceCounts = new SvelteMap<number, Record<string, number>>();
const mapStageFeatureStateCounts = new SvelteMap<number, number>();
const cleanupFaults = new SvelteMap<
	string,
	{ readonly error: Error; readonly phase: 'before' | 'after'; remaining: number }
>();

function aggregateCounts(
	countsByStage: ReadonlyMap<number, Readonly<Record<string, number>>>,
	includeReleased: boolean,
): Readonly<Record<string, number>> {
	const aggregate: Record<string, number> = {};
	for (const counts of countsByStage.values()) {
		for (const [type, count] of Object.entries(counts)) {
			aggregate[type] = (aggregate[type] ?? 0) + count;
		}
	}
	if (!includeReleased) {
		for (const [type, count] of Object.entries(aggregate)) {
			if (count === 0) delete aggregate[type];
		}
	}
	return aggregate;
}

export const mapHeroReceiptSignals = {
	clock: {
		get serverNow() {
			return serverNow;
		},
		get now() {
			return serverNow;
		},
		serverNowContinuousMs() {
			return serverNow;
		},
		subscribe: () => () => {},
	},
	get vehiclesGeneration() {
		return vehiclesGeneration;
	},
	get motionMode() {
		return currentMotionMode;
	},
	get featureStateEvents() {
		return featureStateEvents;
	},
	get mapStageListenerCounts() {
		return aggregateCounts(mapStageListenerCounts, true);
	},
	get mapStageSourceCounts() {
		return aggregateCounts(mapStageSourceCounts, false);
	},
	get mapStageFeatureStateCount() {
		return [...mapStageFeatureStateCounts.values()].reduce((total, count) => total + count, 0);
	},
	advanceClock(deltaMs: number) {
		serverNow += deltaMs;
	},
	setVehiclesGeneration(generation: string) {
		vehiclesGeneration = generation;
	},
	setMotionMode(mode: 'raw' | 'smooth') {
		currentMotionMode = mode;
	},
	recordFeatureState(event: MapHeroFeatureStateEvent) {
		featureStateEvents.push(event);
		featureStateObserver?.(event);
	},
	clearFeatureStateEvents() {
		featureStateEvents = [];
	},
	observeFeatureState(observer: ((event: MapHeroFeatureStateEvent) => void) | null) {
		featureStateObserver = observer;
	},
	setCleanupFault(
		operation: string,
		error: Error,
		phase: 'before' | 'after' = 'before',
		times = 1,
	) {
		cleanupFaults.set(operation, { error, phase, remaining: times });
	},
	throwCleanupFault(operation: string, phase: 'before' | 'after') {
		const fault = cleanupFaults.get(operation);
		if (!fault || fault.phase !== phase) return;
		fault.remaining -= 1;
		if (fault.remaining === 0) cleanupFaults.delete(operation);
		throw fault.error;
	},
	createMapStageReceipt() {
		const stageId = ++mapStageSequence;
		mapStageListenerCounts.set(stageId, {});
		mapStageSourceCounts.set(stageId, {});
		mapStageFeatureStateCounts.set(stageId, 0);
		return {
			recordListenerCount(type: string, count: number) {
				mapStageListenerCounts.set(stageId, {
					...mapStageListenerCounts.get(stageId),
					[type]: count,
				});
			},
			recordSourceCount(type: string, count: number) {
				mapStageSourceCounts.set(stageId, {
					...mapStageSourceCounts.get(stageId),
					[type]: count,
				});
			},
			recordFeatureStateCount(count: number) {
				mapStageFeatureStateCounts.set(stageId, count);
			},
		};
	},
	reset() {
		serverNow = BASE_TIME;
		vehiclesGeneration = BASE_GENERATION;
		currentMotionMode = 'raw';
		featureStateEvents = [];
		featureStateObserver = null;
		mapStageSequence = 0;
		mapStageListenerCounts.clear();
		mapStageSourceCounts.clear();
		mapStageFeatureStateCounts.clear();
		cleanupFaults.clear();
	},
};
