// alertDisplay.ts — the ONE locale-aware alert headline resolver (S15 relocation).
//
// Every alert surface (the map detail, AffectedAlerts, the /alerts history log)
// renders an alert's headline through THIS resolver so a past alert reads exactly
// like the live ones a rider already knows. It scrubs HTML, drops the generic
// "your stop"/"your line" placeholders, and falls back to the shared bilingual
// "Service alert" string — never a raw or fabricated headline.
//
// Pure i18n over the Alert contract shape: zero Svelte, zero DOM, provider-agnostic.
// Lives in $lib/v1 (beside schemas/enumLabels) — hoisted out of features/map so the
// alerts surface reads it without a cross-feature import (S15 exemption removal).
// The map-RUNTIME helpers (buildAlertEntitySets/vehicleHasAlert) stay in
// features/map/mapAlerts, which imports alertDisplayText from here when it needs it.

import type { Locale } from '$lib/i18n';

/** The shared source-copy shape carried by live, current-history, and archive alerts. */
export interface AlertDisplaySource {
	readonly header_key?: string | null;
	readonly header_text?: string | null;
	readonly header_text_en?: string | null;
	readonly description?: string | null;
	readonly description_en?: string | null;
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
		.replace(/\s+([,.;:!?])/g, '$1')
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
		normalized === 'undefined' ||
		/["']text["']\s*:\s*(?:none|null|undefined)\b/.test(normalized)
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

export function alertDisplayText(alert: AlertDisplaySource, locale: Locale): string {
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
