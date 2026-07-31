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
	readonly url?: string | null;
	readonly url_en?: string | null;
}

export interface AlertDisplayResult {
	readonly text: string;
	readonly lang: 'en' | 'fr' | null;
	readonly isFallback: boolean;
}

export interface AlertDisplayUrlResult {
	readonly href: string;
	readonly host: string;
	readonly lang: 'en' | 'fr';
	readonly isFallback: boolean;
}

function safeUrl(raw: string | null | undefined): { href: string; host: string } | null {
	if (raw == null || !raw.trim()) return null;
	try {
		const parsed = new URL(raw.trim());
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		return { href: parsed.href, host: parsed.host };
	} catch {
		return null;
	}
}

export function alertDisplayUrl(
	alert: Pick<AlertDisplaySource, 'url' | 'url_en'>,
	locale: Locale,
): AlertDisplayUrlResult | null {
	const requestedLang = locale === 'fr' ? 'fr' : 'en';
	const otherLang = requestedLang === 'fr' ? 'en' : 'fr';
	const requested = safeUrl(requestedLang === 'fr' ? alert.url : alert.url_en);
	if (requested) return { ...requested, lang: requestedLang, isFallback: false };
	const fallback = safeUrl(otherLang === 'fr' ? alert.url : alert.url_en);
	return fallback ? { ...fallback, lang: otherLang, isFallback: true } : null;
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

export function alertDisplayText(alert: AlertDisplaySource, locale: Locale): AlertDisplayResult {
	const requestedLang = locale === 'fr' ? 'fr' : 'en';
	const otherLang = requestedLang === 'fr' ? 'en' : 'fr';
	const requestedDescription = requestedLang === 'fr' ? alert.description : alert.description_en;
	const requestedHeader = requestedLang === 'fr' ? alert.header_text : alert.header_text_en;
	const otherDescription = otherLang === 'fr' ? alert.description : alert.description_en;
	const otherHeader = otherLang === 'fr' ? alert.header_text : alert.header_text_en;

	const requestedDescriptionText = cleanText(requestedDescription);
	if (requestedDescriptionText) {
		return { text: requestedDescriptionText, lang: requestedLang, isFallback: false };
	}

	const requestedHeaderText = meaningfulHeader(requestedHeader);
	if (requestedHeaderText) {
		return { text: requestedHeaderText, lang: requestedLang, isFallback: false };
	}

	const otherDescriptionText = cleanText(otherDescription);
	if (otherDescriptionText) {
		return { text: otherDescriptionText, lang: otherLang, isFallback: true };
	}

	const otherHeaderText = meaningfulHeader(otherHeader);
	if (otherHeaderText) {
		return { text: otherHeaderText, lang: otherLang, isFallback: true };
	}

	const headerKeyText = meaningfulHeader(alert.header_key);
	if (headerKeyText) {
		return { text: headerKeyText, lang: null, isFallback: true };
	}

	return {
		text: requestedLang === 'fr' ? 'Alerte de service' : 'Service alert',
		lang: requestedLang,
		isFallback: false,
	};
}
