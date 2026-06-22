// alerts.copy.ts: co-located bilingual copy for the Alert History surface
// (slice-9.6 Family D, "Avis").
//
// All user-facing strings the AlertHistory screen renders live here, keyed by
// Locale, so the .svelte file carries zero inline literals. Provider-agnostic:
// no STM / Montréal names. The cross-surface alert presentation (headline,
// cause/effect, severity glyph + word) is inherited from the shared
// $lib/components/surface/AffectedAlerts vocabulary + the map's
// gtfsAlertLabels/alertDisplayText helpers, so this file only carries the
// history-specific captions (window, duration, impact, breakdown sections).

import type { Locale } from '$lib/i18n';
import type { SeverityCode } from '$lib/v1/schemas';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface AlertHistoryCopy extends SurfaceHeadCopy {
	/** Section label over the chronological alert log. */
	readonly logSection: string;
	/** Accessible label for the alert list (the chronological history). */
	readonly logListLabel: string;
	/** Caption naming how many past alerts are shown (capped). */
	readonly count: (shown: number, total: number) => string;
	/** "+N more" disclosure label when the log overflows the visible cap. */
	readonly more: (n: number) => string;
	/** Label to collapse the expanded log back to the capped view. */
	readonly showLess: string;
	/** Shown when the archive carries no past alerts (honest empty state). */
	readonly empty: string;
	/** Per-row meta captions. */
	readonly meta: {
		/** "From" caption for an alert with a start time. */
		readonly from: string;
		/** "Until" caption for an alert with an end time. */
		readonly until: string;
		/** "Duration" caption + a localized minutes value builder. */
		readonly duration: string;
		readonly durationValue: (min: number) => string;
		/** "Affected" caption naming the touched routes/stops. */
		readonly routes: string;
		readonly stops: string;
		/** Estimated rider-impact passages caption + value builder. */
		readonly impact: string;
		readonly impactValue: (passages: number) => string;
	};
	/** Visually-hidden severity words, keyed by SeverityCode (a11y). */
	readonly severity: Record<SeverityCode, string>;
	/** The client-side filter rail over the alert log (entity type + severity). */
	readonly filters: {
		/** Group label for the whole filter control panel. */
		readonly railLabel: string;
		/** Entity-type axis: filter by what an alert affects (lines / stops). */
		readonly entity: {
			/** Radiogroup label. */
			readonly label: string;
			/** "All" — clears the entity filter. */
			readonly all: string;
			/** Alerts that affect at least one line. */
			readonly lines: string;
			/** Alerts that affect at least one stop. */
			readonly stops: string;
		};
		/** Severity axis: filter by the alert's banded severity. */
		readonly severity: {
			/** Radiogroup label. */
			readonly label: string;
			/** "All" — clears the severity filter. */
			readonly all: string;
		};
		/** Specific-entity axis: narrow to alerts touching ONE chosen route/stop. */
		readonly entityPick: {
			/** Searchable-picker field label. */
			readonly label: string;
			/** Placeholder in the search field. */
			readonly placeholder: string;
			/** Accessible group label over the chip set of affected entities. */
			readonly groupLabel: string;
			/** Chip prefix for a route entity (e.g. "Line 24"). */
			readonly route: (id: string) => string;
			/** Chip prefix for a stop entity (e.g. "Stop 52458"). */
			readonly stop: (id: string) => string;
			/** Active-selection caption ("Showing alerts for …"). */
			readonly active: (label: string) => string;
			/** "Clear" the chosen entity (returns to all entities of the type). */
			readonly clear: string;
			/** Shown when the search query matches no affected entity. */
			readonly noEntity: string;
		};
		/** Honest no-match note shown when the active filters narrow the log to zero. */
		readonly noMatch: string;
		/** "Clear filters" action that restores the full log. */
		readonly clear: string;
	};
	/** The cause / effect / severity distribution sections (Tier-2 breakdown). */
	readonly breakdown: {
		/** Section label over the whole distribution block. */
		readonly section: string;
		/** Sub-headings for the three distributions. */
		readonly byCause: string;
		readonly byEffect: string;
		readonly bySeverity: string;
		/** Accessible list labels for each distribution. */
		readonly byCauseLabel: string;
		readonly byEffectLabel: string;
		readonly bySeverityLabel: string;
		/** Per-bucket count caption ("N alerts") + median-duration subtitle. */
		readonly buckets: (count: number) => string;
		readonly median: (min: number) => string;
		/** Fallback label for an unspecified cause/effect bucket (key="unknown"). */
		readonly unspecified: string;
	};
}

const SEVERITY_WORDS: Record<Locale, Record<SeverityCode, string>> = {
	fr: { critical: 'Critique', high: 'Élevé', watch: 'À surveiller' },
	en: { critical: 'Critical', high: 'High', watch: 'Watch' },
};

export const alertHistoryCopy: Record<Locale, AlertHistoryCopy> = {
	fr: {
		kicker: 'AVIS · ARCHIVE',
		heading: 'Avis',
		subheading: '// HISTORIQUE',
		lede: 'Les avis de service passés, du plus récent au plus ancien, avec leur durée et leur portée. On n’invente jamais de données : un champ absent reste absent.',
		logSection: 'Avis passés',
		logListLabel: 'Avis de service passés, du plus récent au plus ancien',
		count: (shown, total) => `${shown} sur ${total} avis affichés`,
		more: (n) => `+${n} de plus`,
		showLess: 'Réduire',
		empty: 'Aucun avis de service archivé pour le moment.',
		meta: {
			from: 'À partir de',
			until: 'Jusqu’à',
			duration: 'Durée',
			durationValue: (min) => `${min} min`,
			routes: 'Lignes touchées',
			stops: 'Arrêts touchés',
			impact: 'Passages touchés (est.)',
			impactValue: (passages) => `${passages.toLocaleString('fr-CA')} passages`,
		},
		severity: SEVERITY_WORDS.fr,
		filters: {
			railLabel: 'Filtres',
			entity: {
				label: 'Touche',
				all: 'Tout',
				lines: 'Lignes',
				stops: 'Arrêts',
			},
			severity: {
				label: 'Gravité',
				all: 'Toutes',
			},
			entityPick: {
				label: 'Élément précis',
				placeholder: 'Filtrer les lignes et arrêts touchés…',
				groupLabel: 'Éléments touchés',
				route: (id) => `Ligne ${id}`,
				stop: (id) => `Arrêt ${id}`,
				active: (label) => `Avis pour ${label}`,
				clear: 'Effacer',
				noEntity: 'Aucun élément touché ne correspond.',
			},
			noMatch: 'Aucun avis ne correspond aux filtres sélectionnés.',
			clear: 'Effacer les filtres',
		},
		breakdown: {
			section: 'Répartition',
			byCause: 'Par cause',
			byEffect: 'Par effet',
			bySeverity: 'Par gravité',
			byCauseLabel: 'Répartition des avis par cause',
			byEffectLabel: 'Répartition des avis par effet',
			bySeverityLabel: 'Répartition des avis par gravité',
			buckets: (count) => `${count.toLocaleString('fr-CA')} avis`,
			median: (min) => `durée médiane ${min} min`,
			unspecified: 'Non précisé',
		},
	},
	en: {
		kicker: 'ALERTS · ARCHIVE',
		heading: 'Alerts',
		subheading: '// HISTORY',
		lede: 'Past service alerts, newest first, with their duration and reach. We never invent data: an absent field stays absent.',
		logSection: 'Past alerts',
		logListLabel: 'Past service alerts, newest first',
		count: (shown, total) => `Showing ${shown} of ${total} alerts`,
		more: (n) => `+${n} more`,
		showLess: 'Show less',
		empty: 'No archived service alerts yet.',
		meta: {
			from: 'From',
			until: 'Until',
			duration: 'Duration',
			durationValue: (min) => `${min} min`,
			routes: 'Lines affected',
			stops: 'Stops affected',
			impact: 'Passages affected (est.)',
			impactValue: (passages) => `${passages.toLocaleString('en-CA')} passages`,
		},
		severity: SEVERITY_WORDS.en,
		filters: {
			railLabel: 'Filters',
			entity: {
				label: 'Affects',
				all: 'All',
				lines: 'Lines',
				stops: 'Stops',
			},
			severity: {
				label: 'Severity',
				all: 'All',
			},
			entityPick: {
				label: 'Specific entity',
				placeholder: 'Filter affected lines and stops…',
				groupLabel: 'Affected entities',
				route: (id) => `Line ${id}`,
				stop: (id) => `Stop ${id}`,
				active: (label) => `Alerts for ${label}`,
				clear: 'Clear',
				noEntity: 'No affected entity matches.',
			},
			noMatch: 'No alerts match the selected filters.',
			clear: 'Clear filters',
		},
		breakdown: {
			section: 'Breakdown',
			byCause: 'By cause',
			byEffect: 'By effect',
			bySeverity: 'By severity',
			byCauseLabel: 'Alert distribution by cause',
			byEffectLabel: 'Alert distribution by effect',
			bySeverityLabel: 'Alert distribution by severity',
			buckets: (count) => `${count.toLocaleString('en-CA')} alerts`,
			median: (min) => `median duration ${min} min`,
			unspecified: 'Unspecified',
		},
	},
};
