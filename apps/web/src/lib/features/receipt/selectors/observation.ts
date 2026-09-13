import { localizeHref, type Locale } from '$lib/i18n';
import { fmtDelayMin, fmtPct } from '$lib/utils';
import type { Manifest, Receipt, ReceiptsIndex } from '$lib/v1/schemas';
import { entityUrl } from '$lib/v1/config';
import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
import { copy } from '../receipt.copy';

export function receiptObservation(
	receipt: Receipt,
	index: ReceiptsIndex,
	manifest: Manifest,
	locale: Locale,
	origin: string,
): string {
	const t = copy[locale];
	const labels = t.observation;
	const availability = index.available?.find((entry) => entry.date === receipt.date);
	const reported = (value: boolean | undefined) =>
		value == null ? labels.unknown : value ? labels.yes : labels.no;
	const absolute = (href: string) => new URL(href, origin).href;
	const receiptPage = new URL(localizeHref('/receipt', locale), origin);
	receiptPage.searchParams.set('date', receipt.date);
	const dates = [...(index.dates ?? [])].sort();
	const values: readonly [MetricKey, string, string | null][] = [
		['otp', t.metrics.onTime, fmtPct(receipt.otp_pct)],
		['avgDelay', t.metrics.avgDelay, fmtDelayMin(receipt.avg_delay_min, { rounding: 'auto' })],
		['severe', t.metrics.severe, fmtPct(receipt.severe_pct, { rounding: 'fixed1' })],
	];
	return [
		`Transit: ${t.heading}`,
		`${labels.provider}: ${manifest.display_name} (${manifest.provider})`,
		`${labels.date}: ${receipt.date}${manifest.tz ? ` (${manifest.tz})` : ''}`,
		...values.map(([, label, value]) => `${label}: ${value ?? labels.unknown}`),
		t.caveat,
		`${labels.generated}: ${receipt.generated_utc}`,
		...(receipt.publish_generation_id
			? [`${labels.generation}: ${receipt.publish_generation_id}`]
			: []),
		...(receipt.methodology_version
			? [`${labels.methodology}: ${receipt.methodology_version}`]
			: []),
		...(dates.length ? [`${labels.coverage}: ${dates[0]} – ${dates[dates.length - 1]}`] : []),
		`${labels.telemetry}: ${reported(availability?.has_data)}`,
		`${labels.schedule}: ${reported(availability?.has_schedule)}`,
		`${labels.page}: ${receiptPage.href}`,
		`${labels.source}: ${absolute(entityUrl('historic', manifest.files.historic?.receipts_prefix ?? 'historic/receipts/', receipt.date))}`,
		...values.map(
			([key, label]) =>
				`${labels.definitions} (${label}): ${absolute(metricInfoFor(key, locale).href)}`,
		),
	].join('\n');
}
