import type { Locale } from '$lib/i18n';
import type { StatusCode, OccupancyCode, SeverityCode } from './schemas';

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

export const SEVERITY_LABELS: Record<Locale, Record<SeverityCode, string>> = {
	en: { critical: 'Critical', high: 'High', watch: 'Watch' },
	fr: { critical: 'Critique', high: 'Élevé', watch: 'À surveiller' },
};
