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
