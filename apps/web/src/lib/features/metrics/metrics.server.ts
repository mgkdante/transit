import { highlight } from '@yesid/seo-kit/highlight';
import { METRICS } from './metrics.content';
import type { MetricSqlHtml } from './MetricBody.svelte';

let sqlHtml: Promise<MetricSqlHtml> | undefined;

/** Each metric's highlighted source, once per isolate: the sources are static. */
export function getMetricSqlHtml(): Promise<MetricSqlHtml> {
	sqlHtml ??= Promise.all(
		METRICS.map(
			async (entry) =>
				[entry.key, await highlight(entry.sql, entry.codeLanguage ?? 'sql')] as const,
		),
	).then((entries) => Object.fromEntries(entries) as MetricSqlHtml);
	return sqlHtml;
}
