import { createAnalyticsClient } from '@yesid/analytics/client';
import { TRANSIT_ANALYTICS_PRESET } from './preset';

export const transitAnalytics = createAnalyticsClient(TRANSIT_ANALYTICS_PRESET, {
	canTrack: () => false,
	getReferrer: () => '',
	loadTransport: () => {
		throw new Error('Transit analytics transport is not active');
	},
});
