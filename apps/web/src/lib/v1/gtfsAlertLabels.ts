// gtfsAlertLabels.ts — bilingual labels for GTFS-RT Cause + Effect enums.
//
// Live alerts carry `cause` / `effect` as RAW GTFS-RT enum names (e.g.
// "CONSTRUCTION", "DETOUR"). The contract types them as free strings: a value
// may be a known GTFS-RT enum, OR a vendor extension (e.g. str(int)). So this
// maps the known enums to FR/EN display labels and HUMANIZES anything else
// gracefully ("POLICE_ACTIVITY" → "Police activity") rather than ever showing
// a raw SCREAMING_SNAKE string to a rider.
//
// Provider-agnostic: GTFS-RT cause/effect are part of the standard spec, shared
// across every provider. Nothing here is STM-specific. Lives in $lib/v1 (beside
// enumLabels) — hoisted out of features/map so the alerts surface reads it without
// a cross-feature import (S15 exemption removal).

import type { Locale } from '$lib/i18n';

type LocaleMap = Record<Locale, string>;

// GTFS-RT Cause enum (transit_realtime.Alert.Cause). UNKNOWN_CAUSE / OTHER_CAUSE
// are intentionally omitted: they carry no information, so we render nothing.
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

// GTFS-RT Effect enum (transit_realtime.Alert.Effect). UNKNOWN_EFFECT /
// OTHER_EFFECT / NO_EFFECT are omitted: no rider-facing meaning.
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

// Enum names that carry no rider-facing meaning — render nothing rather than a
// noisy "Unknown" / "Other" chip.
const UNINFORMATIVE = new Set([
	'UNKNOWN_CAUSE',
	'OTHER_CAUSE',
	'UNKNOWN_EFFECT',
	'OTHER_EFFECT',
	'NO_EFFECT',
]);

// Title-case a raw SCREAMING_SNAKE (or kebab/space) value: "POLICE_ACTIVITY" →
// "Police activity". First word capitalized, the rest lowercased — never shown
// raw-uppercase-with-underscores. A bare str(int) vendor code (e.g. "7") drops
// out as uninformative below before reaching here.
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
	// Known GTFS-RT enum → curated bilingual label.
	if (table[normalized]) return table[normalized][locale];
	// Uninformative enum (UNKNOWN_*/OTHER_*/NO_EFFECT) or a bare numeric vendor
	// code → render nothing; it tells the rider nothing.
	if (UNINFORMATIVE.has(normalized) || /^\d+$/.test(key)) return null;
	// Unknown/vendor enum name → graceful humanized fallback.
	return humanize(key);
}

/** Bilingual label for a GTFS-RT Cause, or null when absent/uninformative. */
export function causeLabel(cause: string | null | undefined, locale: Locale): string | null {
	return resolve(cause, CAUSE_LABELS, locale);
}

/** Bilingual label for a GTFS-RT Effect, or null when absent/uninformative. */
export function effectLabel(effect: string | null | undefined, locale: Locale): string | null {
	return resolve(effect, EFFECT_LABELS, locale);
}
