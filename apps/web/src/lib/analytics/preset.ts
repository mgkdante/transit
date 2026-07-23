import { defineAnalyticsPreset } from '@yesid/analytics/config';

export const TRANSIT_ANALYTICS_PRESET = defineAnalyticsPreset({
	domain: 'transit.yesid.dev',
	events: [] as const,
	storageKeys: {
		consent: 'transit:analytics-consent:v1',
		preferencesOpen: 'transit:analytics-preferences-open:v1',
		denialSafety: 'transit:analytics-denial-safety:v1',
		storageProbe: 'transit:analytics-storage-probe:v1',
	},
});
