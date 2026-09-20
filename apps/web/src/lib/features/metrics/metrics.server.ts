import { render } from 'svelte/server';
import type { Locale } from '$lib/i18n';
import { METRICS } from './metrics.content';
import MetricBody, { type MetricBodies } from './MetricBody.svelte';

const bodiesByLocale = new Map<Locale, MetricBodies>();

/** Static repository content is rendered once per locale and worker instance. */
export function getMetricBodies(locale: Locale): MetricBodies {
	let bodies = bodiesByLocale.get(locale);
	if (!bodies) {
		bodies = Object.fromEntries(
			METRICS.map((entry) => [entry.key, render(MetricBody, { props: { entry, locale } }).body]),
		) as MetricBodies;
		bodiesByLocale.set(locale, bodies);
	}
	return bodies;
}
