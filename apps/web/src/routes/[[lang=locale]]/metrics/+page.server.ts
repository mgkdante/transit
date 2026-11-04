import type { PageServerLoad } from './$types';
import { getMetricSqlHtml } from '#lib/features/metrics/metrics.server.ts';

export const load: PageServerLoad = async () => ({ sqlHtml: await getMetricSqlHtml() });
