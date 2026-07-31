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
	reset() {
		serverNow = BASE_TIME;
		vehiclesGeneration = BASE_GENERATION;
		currentMotionMode = 'raw';
		featureStateEvents = [];
		featureStateObserver = null;
	},
};
