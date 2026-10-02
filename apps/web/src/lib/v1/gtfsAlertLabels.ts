import type { Locale } from '$lib/i18n';

type LocaleMap = Record<Locale, string>;

const CAUSE_LABELS: Record<string, LocaleMap> = {
	TECHNICAL_PROBLEM: { en: 'Technical problem', fr: 'Problème technique' },
	STRIKE: { en: 'Strike', fr: 'Grève' },
	DEMONSTRATION: { en: 'Demonstration', fr: 'Manifestation' },
	ACCIDENT: { en: 'Accident', fr: 'Accident' },
	HOLIDAY: { en: 'Holiday', fr: 'Jour férié' },
	WEATHER: { en: 'Weather', fr: 'Météo' },
	MAINTENANCE: { en: 'Maintenance', fr: 'Entretien' },
	CONSTRUCTION: { en: 'Construction', fr: 'Travaux' },
	POLICE_ACTIVITY: { en: 'Police activity', fr: 'Activité policière' },
	MEDICAL_EMERGENCY: { en: 'Medical emergency', fr: 'Urgence médicale' },
};

const EFFECT_LABELS: Record<string, LocaleMap> = {
	NO_SERVICE: { en: 'No service', fr: 'Aucun service' },
	REDUCED_SERVICE: { en: 'Reduced service', fr: 'Service réduit' },
	SIGNIFICANT_DELAYS: { en: 'Significant delays', fr: 'Retards importants' },
	DETOUR: { en: 'Detour', fr: 'Détour' },
	ADDITIONAL_SERVICE: { en: 'Additional service', fr: 'Service supplémentaire' },
	MODIFIED_SERVICE: { en: 'Modified service', fr: 'Service modifié' },
	STOP_MOVED: { en: 'Stop moved', fr: 'Arrêt déplacé' },
	ACCESSIBILITY_ISSUE: { en: 'Accessibility issue', fr: "Problème d'accessibilité" },
};

const UNINFORMATIVE = new Set([
	'UNKNOWN_CAUSE',
	'OTHER_CAUSE',
	'UNKNOWN_EFFECT',
	'OTHER_EFFECT',
	'NO_EFFECT',
]);

function humanize(raw: string): string {
	const words = raw
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean);
	if (words.length === 0) return '';
	return words
		.map((word, index) =>
			index === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase(),
		)
		.join(' ');
}

function resolve(
	raw: string | null | undefined,
	table: Record<string, LocaleMap>,
	locale: Locale,
): string | null {
	if (raw == null) return null;
	const key = raw.trim();
	if (!key) return null;

	const normalized = key.toUpperCase();
	if (table[normalized]) return table[normalized][locale];
	if (UNINFORMATIVE.has(normalized) || /^\d+$/.test(key)) return null;
	return humanize(key);
}

export function causeLabel(cause: string | null | undefined, locale: Locale): string | null {
	return resolve(cause, CAUSE_LABELS, locale);
}

export function effectLabel(effect: string | null | undefined, locale: Locale): string | null {
	return resolve(effect, EFFECT_LABELS, locale);
}
