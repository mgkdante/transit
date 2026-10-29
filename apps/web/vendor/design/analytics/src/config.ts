export interface AnalyticsPreset<EventName extends string = string> {
	readonly events: readonly EventName[];
}

export type AnalyticsEventName<Preset extends AnalyticsPreset> = Preset['events'][number];

export function defineAnalyticsPreset<const EventName extends string>(
	preset: AnalyticsPreset<EventName>,
): AnalyticsPreset<EventName> {
	return preset;
}
