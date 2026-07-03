// enumLabels.ts — the ONE bilingual display vocabulary for the v1 closed enums.
//
// Pure data + types. Zero Svelte, zero DOM. Lives beside schemas/types.ts so the
// labels are the single canonical rendering of StatusCode / OccupancyCode — every
// surface (map legend, network band, search result) reads THIS table, so the FR
// voice can never drift between features again (it silently had: map said
// "Grave"/"Places assises"/"Peu de sièges", network said the winning variants).
//
// FR register (S7.5 P3-1): the network variants own the three once-drifted keys —
// severe='Sévère', many_seats='Plusieurs places', few_seats='Peu de places'
// (standard FR transit register; 'places' parallels the whole crowding scale).
import type { Locale } from '$lib/i18n';
import type { StatusCode, OccupancyCode, SeverityCode } from './schemas';

/** Localized StatusCode labels (map status legend + network status-mix bar/legend). */
export const STATUS_LABELS: Record<Locale, Record<StatusCode, string>> = {
	en: { early: 'Early', on_time: 'On-time', late: 'Late', severe: 'Severe', unknown: 'Unknown' },
	fr: {
		early: 'En avance',
		on_time: 'À l’heure',
		late: 'En retard',
		severe: 'Sévère',
		unknown: 'Inconnu',
	},
};

/** Localized OccupancyCode labels (map crowding legend + network crowding bar/legend). */
export const OCCUPANCY_LABELS: Record<Locale, Record<OccupancyCode, string>> = {
	en: {
		empty: 'Empty',
		many_seats: 'Many seats',
		few_seats: 'Few seats',
		standing: 'Standing',
		full: 'Full',
	},
	fr: {
		empty: 'Vide',
		many_seats: 'Plusieurs places',
		few_seats: 'Peu de places',
		standing: 'Debout',
		full: 'Plein',
	},
};

/**
 * Localized SeverityCode labels (the alert severity vocabulary — the visually-hidden
 * a11y word on an alert row, the severity filter chips, the by-severity breakdown).
 * S15 hoisted the alerts.copy SEVERITY_WORDS here so the alert surfaces read the SAME
 * one vocabulary as the cause/effect labels beside them, never a per-feature copy that
 * can drift.
 */
export const SEVERITY_LABELS: Record<Locale, Record<SeverityCode, string>> = {
	en: { critical: 'Critical', high: 'High', watch: 'Watch' },
	fr: { critical: 'Critique', high: 'Élevé', watch: 'À surveiller' },
};
