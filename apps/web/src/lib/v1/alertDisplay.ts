import type { Locale } from '$lib/i18n';
import type { AlertMessageProvenance } from './schemas/alert_history';

export interface AlertDisplaySource {
	readonly message?: AlertMessageProvenance | null;
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
	readonly lang: string | null;
	readonly isFallback: boolean;
}

export interface AlertDisplayUrlResult {
	readonly href: string;
	readonly host: string;
	readonly lang: string | null;
	readonly isFallback: boolean;
}

export function safeAlertUrl(
	raw: string | null | undefined,
): { href: string; host: string } | null {
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
	alert: AlertDisplaySource,
	locale: Locale,
): AlertDisplayUrlResult | null {
	for (const [source, english, language, embedded] of [
		[alert.url, alert.url_en, alert.message?.url_language, false],
		[alert.description, alert.description_en, alert.message?.description_language, true],
	] as const) {
		const parse = embedded ? embeddedAlertUrl : safeAlertUrl;
		const candidates = [
			{ value: parse(source), lang: language ?? null },
			{ value: parse(english), lang: 'en' },
		];
		const selected =
			candidates.find((item) => item.value && item.lang === locale) ??
			candidates.find((item) => item.value);
		if (selected?.value) {
			const lang = embedded ? null : selected.lang;
			return { ...selected.value, lang, isFallback: lang !== locale };
		}
	}
	return null;
}

function embeddedAlertUrl(description: string | null | undefined) {
	const urls = new Map<string, { href: string; host: string }>();
	const entities: Record<string, string> = {
		amp: '&',
		quot: '"',
		apos: "'",
		lt: '<',
		gt: '>',
		colon: ':',
	};
	for (const [tag] of (description ?? '').matchAll(
		/<a(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*>/gi,
	)) {
		const attr = [...tag.matchAll(/\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)].find(
			(match) => match[1].toLowerCase() === 'href',
		);
		const href = (attr?.[2] ?? attr?.[3] ?? '').replace(
			/&(#x[\da-f]+|#\d+|[a-z]+);/gi,
			(entity, key: string) => {
				if (!key.startsWith('#')) return Object.hasOwn(entities, key) ? entities[key] : entity;
				const code =
					key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
				return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
			},
		);
		const url = /&(?:#\w+|[a-z]+);/i.test(href) ? null : safeAlertUrl(href);
		if (url) urls.set(url.href, url);
	}
	return urls.size === 1 ? [...urls.values()][0] : null;
}

export function alertLanguageNotice(
	result: Pick<AlertDisplayResult, 'lang' | 'isFallback'> | null,
	locale: Locale,
): string | null {
	if (!result?.isFallback) return null;
	if (result.lang === 'fr') return '(French only)';
	if (result.lang === 'en') return '(en anglais seulement)';
	if (result.lang == null)
		return locale === 'fr' ? '(langue source non précisée)' : '(Source language unspecified)';
	return locale === 'fr' ? '(traduction indisponible)' : '(Translation unavailable)';
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
	const candidates = [
		{ text: cleanText(alert.description), lang: alert.message?.description_language ?? null },
		{ text: cleanText(alert.description_en), lang: 'en' },
		{ text: meaningfulHeader(alert.header_text), lang: alert.message?.header_language ?? null },
		{ text: meaningfulHeader(alert.header_text_en), lang: 'en' },
	];
	const selected =
		candidates.find((item) => item.text && item.lang === locale) ??
		candidates.find((item) => item.text);
	if (selected?.text) {
		return { text: selected.text, lang: selected.lang, isFallback: selected.lang !== locale };
	}
	const headerKeyText = meaningfulHeader(alert.header_key);
	if (headerKeyText) return { text: headerKeyText, lang: null, isFallback: true };
	return {
		text: locale === 'fr' ? 'Alerte de service' : 'Service alert',
		lang: locale,
		isFallback: false,
	};
}
