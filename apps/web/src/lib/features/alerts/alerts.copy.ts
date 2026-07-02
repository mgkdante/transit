// alerts.copy.ts: co-located bilingual copy for the Alert History surface
// (slice-9.6 Family D, "Avis"; re-seated in S15).
//
// All user-facing strings the AlertHistory screen renders live here, keyed by
// Locale, so the .svelte file carries zero inline literals. Provider-agnostic:
// no STM / Montréal names. The cross-surface alert presentation (headline,
// cause/effect, severity word) is inherited from the shared $lib/v1 kernel
// (alertDisplay/gtfsAlertLabels/enumLabels SEVERITY_LABELS), so this file only
// carries the history-specific captions (window, duration, impact, pickers,
// breakdown, headline). S15: SEVERITY_WORDS was hoisted into $lib/v1/enumLabels
// (SEVERITY_LABELS) — the copy reads THAT one vocabulary, never a local copy.

import type { Locale } from '$lib/i18n';
import type { SeverityCode } from '$lib/v1/schemas';
import { SEVERITY_LABELS } from '$lib/v1/enumLabels';
import type { SurfaceHeadCopy } from '$lib/components/surface';
import type { DateRangePickerLabels } from '$lib/components/surface';

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
	/** Honest note when the served window was capped newest-first (truncated=true). */
	readonly truncatedNote: (shown: number, total: number) => string;
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
		/** Header + count caption for the multi-window list (>1 active period). */
		readonly windows: string;
		readonly windowsCount: (n: number) => string;
		/** "Details" external-link caption + a hostname-aware accessible label. */
		readonly link: string;
		readonly linkAria: (host: string) => string;
	};
	/** Visually-hidden severity words, keyed by SeverityCode (a11y). */
	readonly severity: Record<SeverityCode, string>;
	/** The client-side filter rail over the alert log. */
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
		/** The two specific-entity typeahead pickers (Line / Stop). The GROUP label carries
		    the type ONCE, so an option is the bare id (no per-row prefix). */
		readonly line: {
			readonly label: string;
			readonly placeholder: string;
			readonly clear: string;
			readonly empty: string;
		};
		readonly stop: {
			readonly label: string;
			readonly placeholder: string;
			readonly clear: string;
			readonly empty: string;
		};
		/** The date-range picker (?from/?to) labels. */
		readonly window: DateRangePickerLabels;
		/** Honest no-match note shown when the active filters narrow the log to zero. */
		readonly noMatch: string;
		/** "Clear filters" action that restores the full log. */
		readonly clear: string;
	};
	/** The alerts-in-window headline card (ExplainedMetricCard). */
	readonly headline: {
		/** The metric label ("Alerts in window"). */
		readonly label: string;
		/** The big value builder (the in-window alert count). */
		readonly value: (count: number) => string;
		/** The always-visible plain-language explanation. */
		readonly explanation: string;
		/** Sublabel = the median resolved duration across the window's alerts. */
		readonly median: (min: number) => string;
		/** (i) affordance tip + link. */
		readonly tip: string;
		readonly linkLabel: string;
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
		truncatedNote: (shown, total) =>
			`Fenêtre plafonnée : ${shown} avis les plus récents sur ${total} au total.`,
		meta: {
			from: 'À partir de',
			until: 'Jusqu’à',
			duration: 'Durée',
			durationValue: (min) => `${min} min`,
			routes: 'Lignes touchées',
			stops: 'Arrêts touchés',
			impact: 'Passages touchés (est.)',
			impactValue: (passages) => `${passages.toLocaleString('fr-CA')} passages`,
			windows: 'Fenêtres de service',
			windowsCount: (n) => `${n} fenêtres de service`,
			link: 'Détails',
			linkAria: (host) => `Ouvrir les détails de l’avis sur ${host} (nouvel onglet)`,
		},
		severity: SEVERITY_LABELS.fr,
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
			line: {
				label: 'Ligne',
				placeholder: 'Filtrer par ligne…',
				clear: 'Effacer la ligne',
				empty: 'Aucune ligne touchée.',
			},
			stop: {
				label: 'Arrêt',
				placeholder: 'Filtrer par arrêt…',
				clear: 'Effacer l’arrêt',
				empty: 'Aucun arrêt touché.',
			},
			window: {
				group: 'Plage de dates',
				start: 'Du',
				end: 'Au',
				clear: 'Effacer',
				anyStart: 'Au plus tôt',
				anyEnd: 'Au plus tard',
			},
			noMatch: 'Aucun avis ne correspond aux filtres sélectionnés.',
			clear: 'Effacer les filtres',
		},
		headline: {
			label: 'Avis dans la fenêtre',
			value: (count) => count.toLocaleString('fr-CA'),
			explanation:
				'Le nombre d’avis de service actifs dans la plage de dates choisie, avec leur durée médiane. On compte les avis distincts, jamais une estimation.',
			median: (min) => `durée médiane ${min} min`,
			tip: 'Le nombre d’avis distincts dont la fenêtre active recoupe la plage choisie.',
			linkLabel: 'Comment c’est mesuré',
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
		truncatedNote: (shown, total) =>
			`Window capped: showing the ${shown} most recent of ${total} alerts.`,
		meta: {
			from: 'From',
			until: 'Until',
			duration: 'Duration',
			durationValue: (min) => `${min} min`,
			routes: 'Lines affected',
			stops: 'Stops affected',
			impact: 'Passages affected (est.)',
			impactValue: (passages) => `${passages.toLocaleString('en-CA')} passages`,
			windows: 'Service windows',
			windowsCount: (n) => `${n} service windows`,
			link: 'Details',
			linkAria: (host) => `Open the alert details on ${host} (new tab)`,
		},
		severity: SEVERITY_LABELS.en,
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
			line: {
				label: 'Line',
				placeholder: 'Filter by line…',
				clear: 'Clear line',
				empty: 'No affected line.',
			},
			stop: {
				label: 'Stop',
				placeholder: 'Filter by stop…',
				clear: 'Clear stop',
				empty: 'No affected stop.',
			},
			window: {
				group: 'Date range',
				start: 'From',
				end: 'To',
				clear: 'Clear',
				anyStart: 'Earliest',
				anyEnd: 'Latest',
			},
			noMatch: 'No alerts match the selected filters.',
			clear: 'Clear filters',
		},
		headline: {
			label: 'Alerts in window',
			value: (count) => count.toLocaleString('en-CA'),
			explanation:
				'How many service alerts were active in the chosen date range, with their median duration. We count distinct alerts, never an estimate.',
			median: (min) => `median duration ${min} min`,
			tip: 'The count of distinct alerts whose active window overlaps the chosen range.',
			linkLabel: 'How this is measured',
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
