import type { PageServerLoad } from './$types';
import { DEFAULT_LOCALE } from '$lib/i18n';
import { getMetricBodies } from '$lib/features/metrics/metrics.server';

export const load: PageServerLoad = ({ locals }) => ({
	metricBodies: getMetricBodies(locals.locale ?? DEFAULT_LOCALE),
});
