import type { Locale } from '$lib/i18n';
import type { Alert, Vehicle } from '$lib/v1/schemas';

export interface AlertEntitySets {
	readonly routes: ReadonlySet<string>;
	readonly stops: ReadonlySet<string>;
}

const GENERIC_ALERT_HEADERS = new Set([
	'your stop',
	'your line',
	'votre arrêt',
	'votre arret',
	'votre ligne',
]);

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function cleanText(value: string | null | undefined): string | null {
	if (value == null) return null;
	const text = stripHtml(String(value));
	if (!text) return null;

	const normalized = text.toLowerCase();
	if (
		normalized === 'none' ||
		normalized === 'null' ||
		normalized.includes("'text': none") ||
		normalized.includes('"text": null') ||
		normalized.includes('"text":null')
	) {
		return null;
	}

	return text;
}

function meaningfulHeader(value: string | null | undefined): string | null {
	const text = cleanText(value);
	if (!text) return null;
	return GENERIC_ALERT_HEADERS.has(text.toLowerCase()) ? null : text;
}

export function alertDisplayText(alert: Alert, locale: Locale): string {
	const descriptions =
		locale === 'fr'
			? [alert.description, alert.description_en]
			: [alert.description_en, alert.description];
	const headers =
		locale === 'fr'
			? [alert.header_text, alert.header_key, alert.header_text_en]
			: [alert.header_text_en, alert.header_text, alert.header_key];

	for (const value of descriptions) {
		const text = cleanText(value);
		if (text) return text;
	}

	for (const value of headers) {
		const text = meaningfulHeader(value);
		if (text) return text;
	}

	return locale === 'fr' ? 'Alerte de service' : 'Service alert';
}

export function buildAlertEntitySets(alerts: readonly Alert[]): AlertEntitySets {
	const routes = new Set<string>();
	const stops = new Set<string>();

	for (const alert of alerts) {
		for (const route of alert.routes ?? []) routes.add(route);
		for (const stop of alert.stops ?? []) stops.add(stop);
	}

	return { routes, stops };
}

export function vehicleHasAlert(vehicle: Vehicle, sets: AlertEntitySets): boolean {
	return (
		(vehicle.route != null && sets.routes.has(vehicle.route)) ||
		(vehicle.next_stop != null && sets.stops.has(vehicle.next_stop))
	);
}
