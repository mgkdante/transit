// metrics.copy.ts — co-located bilingual page chrome for the /metrics explainer.
//
// The PER-METRIC science lives in metrics.content.ts; this file carries only the
// page-level prose: the surface head (kicker / heading / lede), the per-metric
// section labels ("Definition / The math / The SQL / What it's NOT / Caveats"),
// the provenance preamble (predicted schedule-deviation, NOT certified OTP, no
// AVL), the confidence-legend strings, the cluster overlines (mirroring the
// reliability surface), and the (i)-affordance a11y strings.
//
// FR is the canonical product voice; EN mirrors it. Shape: Record<Locale, …> so
// the screen owns no inline strings.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';
import type { MetricClusterKey, Confidence } from './metrics.content';

export interface MetricsCopy extends SurfaceHeadCopy {
	/** Per-metric section labels (mono metric overlines on the page). */
	readonly sections: {
		readonly definition: string;
		readonly math: string;
		readonly sql: string;
		readonly notReally: string;
		readonly caveats: string;
	};
	/** The provenance preamble — the honest framing every number inherits. */
	readonly provenance: {
		/** Overline above the preamble block. */
		readonly label: string;
		/** The doctrine paragraph (proxy / no AVL / NULL-not-0). */
		readonly body: string;
	};
	/** Confidence-legend strings (chip + one line each). */
	readonly confidence: {
		/** Overline above the legend. */
		readonly label: string;
		/** Chip text + meaning per confidence level. */
		readonly levels: Record<Confidence, { readonly chip: string; readonly meaning: string }>;
	};
	/** Jump-nav (table of contents) heading. */
	readonly tocLabel: string;
	/** "Back to top" anchor link text. */
	readonly backToTop: string;
	/** Accessible label for the SQL <pre> block (e.g. "Defining SQL"). */
	readonly sqlAria: string;
	/** Cluster overlines, keyed by cluster (mirror reliability.copy clusters). */
	readonly clusters: Record<MetricClusterKey, string>;
	/** (i)-affordance a11y strings (templated with the metric name). */
	readonly info: {
		/** Trigger aria-label, e.g. "About {name}" → "About On-time %". */
		readonly trigger: (name: string) => string;
		/** Popover link text → opens the explainer at this metric's anchor. */
		readonly link: string;
	};
}

export const metricsCopy: Record<Locale, MetricsCopy> = {
	fr: {
		kicker: 'MÉTHODE · SCIENCE DES MESURES',
		heading: 'Comment on mesure',
		subheading: '// PROXY, PAS UNE PONCTUALITÉ CERTIFIÉE',
		lede: 'Chaque chiffre de fiabilité sur ce site est un proxy dérivé du flux temps réel prédit — pas une mesure certifiée. Voici, par métrique, ce qu’il mesure vraiment, le calcul exact, le SQL, ce qu’il n’est PAS, et ses limites honnêtes.',
		sections: {
			definition: 'Définition',
			math: 'Le calcul',
			sql: 'Le SQL',
			notReally: 'Ce que ce n’est PAS',
			caveats: 'Limites',
		},
		provenance: {
			label: 'Provenance (vaut pour chaque métrique)',
			body: 'Source = écart à l’horaire PRÉDIT du GTFS-RT + alertes. Chaque chiffre de retard / ponctualité / gravité dérive du delay_seconds prédit du flux temps réel — comment les prédictions ont suivi l’horaire. Il n’y a AUCUNE vérité GPS/AVL et rien n’est une ponctualité certifiée par la STM. Tout est pondéré par observations (un relevé = une mise à jour de trajet), pas par trajets ni par usagers : les lignes et les heures à haute fréquence pèsent plus de relevés. Bande à l’heure = delay ∈ [-60 s, +300 s); grave = delay > 300 s (avec |delay| ≤ 3600 s, garde anti-fantôme). NULL est honnête : un dénominateur vide s’affiche « aucune donnée », jamais un 0 fabriqué. Les sentinelles internes __unrouted__ / __unknown_stop__ ne sont jamais de vraies lignes/arrêts.',
		},
		confidence: {
			label: 'Niveaux de confiance',
			levels: {
				proxy: {
					chip: 'proxy',
					meaning:
						'Une estimation dérivée du flux, pas une mesure certifiée. Toutes les métriques de fiabilité sur cette page.',
				},
				medium: {
					chip: 'moyen',
					meaning:
						'Un recensement instantané par véhicule (l’instantané des véhicules en direct), pas un agrégat.',
				},
			},
		},
		tocLabel: 'Aller à une métrique',
		backToTop: 'Retour en haut',
		sqlAria: 'SQL définissant la métrique',
		clusters: {
			punctuality: '01 Ponctualité',
			waitRegularity: '02 Régularité des attentes',
			serviceDelivered: '03 Service assuré',
			crowding: '04 Encombrement',
			habits: '05 Habitudes horaires',
		},
		info: {
			trigger: (name) => `À propos de ${name}`,
			link: 'Comment c’est mesuré',
		},
	},
	en: {
		kicker: 'METHODOLOGY · METRIC SCIENCE',
		heading: 'How we measure',
		subheading: '// PROXY, NOT CERTIFIED OTP',
		lede: 'Every reliability number on this site is a proxy derived from the predicted realtime feed — not a certified measurement. Here, per metric, is what it actually measures, the exact math, the SQL, what it is NOT, and its honest limits.',
		sections: {
			definition: 'Definition',
			math: 'The math',
			sql: 'The SQL',
			notReally: 'What it’s NOT',
			caveats: 'Caveats',
		},
		provenance: {
			label: 'Provenance (applies to every metric)',
			body: 'Source = GTFS-RT PREDICTED schedule-deviation + alerts. Every delay / on-time / severe number derives from the realtime feed’s predicted delay_seconds — how predictions tracked the timetable. There is NO GPS/AVL ground truth and none of it is STM-certified OTP. Everything is observation-weighted (one reading = one trip-update), not trip- or rider-weighted: high-frequency routes and hours contribute more readings. On-time band = delay ∈ [-60s, +300s); severe = delay > 300s (with |delay| ≤ 3600s, the ghost guard). NULL is honest: an empty denominator shows “no data”, never a fabricated 0. The internal sentinels __unrouted__ / __unknown_stop__ are never real routes/stops.',
		},
		confidence: {
			label: 'Confidence levels',
			levels: {
				proxy: {
					chip: 'proxy',
					meaning:
						'A feed-derived estimate, not a certified measurement. All the reliability metrics on this page.',
				},
				medium: {
					chip: 'medium',
					meaning:
						'A point-in-time per-vehicle census (the live vehicle snapshot), not an aggregate.',
				},
			},
		},
		tocLabel: 'Jump to a metric',
		backToTop: 'Back to top',
		sqlAria: 'Defining SQL for the metric',
		clusters: {
			punctuality: '01 Punctuality',
			waitRegularity: '02 Wait regularity',
			serviceDelivered: '03 Service delivered',
			crowding: '04 Crowding',
			habits: '05 Time-of-day habits',
		},
		info: {
			trigger: (name) => `About ${name}`,
			link: 'How this is measured',
		},
	},
};
