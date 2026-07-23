export interface AnalyticsStorageKeys {
	readonly consent: string;
	readonly preferencesOpen: string;
	readonly denialSafety: string;
	readonly storageProbe: string;
}

export interface AnalyticsPreset<EventName extends string = string> {
	readonly domain: string;
	readonly events: readonly EventName[];
	readonly storageKeys: AnalyticsStorageKeys;
}

export type AnalyticsEventName<Preset extends AnalyticsPreset> = Preset['events'][number];

export function defineAnalyticsPreset<const EventName extends string>(
	preset: AnalyticsPreset<EventName>,
): AnalyticsPreset<EventName> {
	return preset;
}
