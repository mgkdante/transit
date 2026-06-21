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
		/**
		 * Overline above the live "Pipeline note (current run)" block — the verbatim
		 * provenance.methodology string for this metric from the latest build, set
		 * apart from the static science above it.
		 */
		readonly pipelineNote: string;
	};
	/** The provenance preamble — the honest framing every number inherits. */
	readonly provenance: {
		/** Overline above the preamble block. */
		readonly label: string;
		/** The doctrine paragraph (proxy / no AVL / NULL-not-0). */
		readonly body: string;
		/**
		 * Honest stand-down line shown in place of the live conformance badge when
		 * the supplementary provenance document fails to load. The static
		 * methodology below it (incl. the structural-gaps card) always renders; this
		 * just names that the live feed-conformance verdict is momentarily absent.
		 */
		readonly unavailable: string;
	};
	/**
	 * The structural-gaps ("Lacunes structurelles") card — an honest, named list of
	 * what these metrics CANNOT tell the rider. Renders on the same spine as the
	 * per-metric methodology cards (a collapsible section, registered in the ToC).
	 */
	readonly lacunes: {
		/** ToC + card title. */
		readonly title: string;
		/** Lede paragraph framing the whole card. */
		readonly lede: string;
		/** The three named gaps; each a heading + plain-language body. */
		readonly gaps: ReadonlyArray<{ readonly heading: string; readonly body: string }>;
	};
	/** Confidence-legend strings (chip + one line each). */
	readonly confidence: {
		/** Overline above the legend. */
		readonly label: string;
		/** Chip text + meaning per confidence level. */
		readonly levels: Record<Confidence, { readonly chip: string; readonly meaning: string }>;
	};
	/**
	 * Quiet-mode (focus reading) affordance — a single header toggle that COLLAPSES
	 * every metric section card so the page becomes a scannable stack of headings,
	 * while leaving the ToC rail fully visible (it never hides the ToC, changes the
	 * grid, or drops the gutter). The choice persists across navigations (the
	 * card-collapse preference, never a hidden ToC). Mirrors the yesid.dev detail-
	 * page "Quiet mode" switch, kept to one restrained control.
	 */
	readonly quiet: {
		/** Visible button label (mono control voice). */
		readonly label: string;
		/** aria-label when quiet mode is OFF (the action the press performs). */
		readonly enable: string;
		/** aria-label when quiet mode is ON (the action the press performs). */
		readonly disable: string;
	};
	/**
	 * The giant vertical edge word for the measured-article shell (the rotated
	 * writing-mode title in the left rail, mirroring yesid.dev's blog/projects
	 * listing layout). A single uppercase word derived from the page subject;
	 * the layout appends a --primary period after it.
	 */
	readonly edgeTitle: string;
	/** Jump-nav (table of contents) heading. */
	readonly tocLabel: string;
	/** Mono prefix for the TOC "{prefix} N / total" counter (yesid uses "SEC"). */
	readonly tocCounterPrefix: string;
	/** "Back to top" anchor link text. */
	readonly backToTop: string;
	/** Accessible label for the SQL <pre> block (e.g. "Defining SQL"). */
	readonly sqlAria: string;
	/** Mobile floating-pill ToC + sheet a11y strings. */
	readonly tocPill: {
		/** Pill button label / sheet trigger (e.g. "Contents"). */
		readonly open: string;
		/** Accessible label for the sheet dialog. */
		readonly title: string;
		/** Accessible label for the close button. */
		readonly close: string;
	};
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
		lede: 'Chaque chiffre de fiabilité sur ce site est un proxy dérivé du flux temps réel prédit, pas une mesure certifiée. Voici, par métrique, ce qu’il mesure vraiment, le calcul exact, le SQL, ce qu’il n’est PAS, et ses limites honnêtes.',
		sections: {
			definition: 'Définition',
			math: 'Le calcul',
			sql: 'Le SQL',
			notReally: 'Ce que ce n’est PAS',
			caveats: 'Limites',
			pipelineNote: 'Note du pipeline (exécution actuelle)',
		},
		provenance: {
			label: 'Provenance (vaut pour chaque métrique)',
			body: 'Source = écart à l’horaire PRÉDIT du GTFS-RT + alertes. Chaque chiffre de retard / ponctualité / gravité dérive du delay_seconds prédit du flux temps réel, comment les prédictions ont suivi l’horaire. Il n’y a AUCUNE vérité GPS/AVL et rien n’est une ponctualité certifiée par l’agence. Tout est pondéré par observations (un relevé = une mise à jour de trajet), pas par trajets ni par usagers : les lignes et les heures à haute fréquence pèsent plus de relevés. Bande à l’heure = delay ∈ [-60 s, +300 s); grave = delay > 300 s (avec |delay| ≤ 3600 s, garde anti-fantôme). NULL est honnête : un dénominateur vide s’affiche « aucune donnée », jamais un 0 fabriqué. Les sentinelles internes __unrouted__ / __unknown_stop__ ne sont jamais de vraies lignes/arrêts.',
			unavailable:
				'Le verdict de conformité du flux n’a pas pu être chargé pour l’instant. La méthodologie ci-dessous reste exacte et complète; seule cette vérification en direct est momentanément indisponible.',
		},
		lacunes: {
			title: 'Lacunes structurelles',
			lede: 'Aussi honnêtes soient-ils, ces chiffres ont des angles morts qu’aucun calcul ne comble. Voici ce qu’ils ne peuvent PAS dire à l’usager, nommé sans détour.',
			gaps: [
				{
					heading: 'La fiabilité n’est PAS pondérée par les usagers',
					body: 'Chaque relevé compte pareil, qu’il vienne d’une ligne bondée ou d’un véhicule presque vide. Une ligne très achalandée en retard pèse autant qu’une ligne déserte en retard. Nous n’avons aucun flux de charge ou d’achalandage pour pondérer selon l’impact humain réel, donc un retard qui touche des centaines de personnes et un retard qui n’en touche presque aucune se valent dans le chiffre.',
				},
				{
					heading: 'Aucun temps réel pour les modes rapides qui n’en diffusent pas',
					body: 'Certains modes de transport rapide ne publient aucun flux GTFS temps réel. Pour eux, la fiabilité en direct (retards, encombrement, non-réponse) n’existe pas dans nos données : seul l’horaire est affiché. La fiabilité en direct sur ce site ne couvre donc que les modes de surface qui diffusent leur position (bus, etc.); les autres montrent l’horaire seul.',
				},
				{
					heading: 'Par arrêt et par ligne, PAS par trajet (origine vers destination)',
					body: 'On mesure la fiabilité à un arrêt et sur une ligne, jamais la fiabilité d’un trajet complet de l’origine à la destination. Les correspondances, le temps de bout en bout et le risque de manquer une connexion ne sont pas mesurés. Nous n’avons aucune matrice origine-destination ni donnée au niveau du trajet, donc un parcours fiable arrêt par arrêt peut quand même mal tourner une fois les correspondances enchaînées.',
				},
			],
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
		quiet: {
			label: 'Lecture',
			enable: 'Activer le mode lecture',
			disable: 'Quitter le mode lecture',
		},
		edgeTitle: 'MESURE',
		tocLabel: 'Aller à une métrique',
		tocCounterPrefix: 'SEC',
		backToTop: 'Retour en haut',
		sqlAria: 'SQL définissant la métrique',
		tocPill: {
			open: 'Sommaire',
			title: 'Aller à une métrique',
			close: 'Fermer le sommaire',
		},
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
		lede: 'Every reliability number on this site is a proxy derived from the predicted realtime feed, not a certified measurement. Here, per metric, is what it actually measures, the exact math, the SQL, what it is NOT, and its honest limits.',
		sections: {
			definition: 'Definition',
			math: 'The math',
			sql: 'The SQL',
			notReally: 'What it’s NOT',
			caveats: 'Caveats',
			pipelineNote: 'Pipeline note (current run)',
		},
		provenance: {
			label: 'Provenance (applies to every metric)',
			body: 'Source = GTFS-RT PREDICTED schedule-deviation + alerts. Every delay / on-time / severe number derives from the realtime feed’s predicted delay_seconds, how predictions tracked the timetable. There is NO GPS/AVL ground truth and none of it is agency-certified OTP. Everything is observation-weighted (one reading = one trip-update), not trip- or rider-weighted: high-frequency routes and hours contribute more readings. On-time band = delay ∈ [-60s, +300s); severe = delay > 300s (with |delay| ≤ 3600s, the ghost guard). NULL is honest: an empty denominator shows “no data”, never a fabricated 0. The internal sentinels __unrouted__ / __unknown_stop__ are never real routes/stops.',
			unavailable:
				'The live feed-conformance verdict could not be loaded right now. The methodology below is still exact and complete; only this live check is momentarily unavailable.',
		},
		lacunes: {
			title: 'Structural gaps',
			lede: 'Honest as these numbers are, they have blind spots no amount of math closes. Here is what they CANNOT tell the rider, named plainly.',
			gaps: [
				{
					heading: 'Reliability is NOT passenger-weighted',
					body: 'Every reading counts the same, whether it comes from a packed route or a near-empty vehicle. A delayed busy route counts exactly the same as a delayed near-empty one. We have no passenger-load or ridership feed to weight by real human impact, so a delay that hits hundreds of riders and one that hits almost nobody land identically in the number.',
				},
				{
					heading: 'No realtime for rapid-transit modes that do not broadcast it',
					body: 'Some rapid-transit modes publish no GTFS-realtime feed at all. For those modes, live reliability (delays, crowding, non-responding) does not exist in our data: only the schedule is shown. So live reliability on this site is surface-mode only (bus, etc.), the modes that broadcast their position; the rest show schedule only.',
				},
				{
					heading: 'Stop-level and route-level, NOT journey (origin to destination)',
					body: 'We measure reliability per stop and per route, never the reliability of a full journey from origin to destination. Transfers, end-to-end trip time, and the risk of missing a connection are not measured. We have no origin-destination matrix and no journey-level data, so a trip that looks reliable stop by stop can still go wrong once the connections are chained together.',
				},
			],
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
		quiet: {
			label: 'Focus',
			enable: 'Enter focus reading',
			disable: 'Exit focus reading',
		},
		edgeTitle: 'METRICS',
		tocLabel: 'Jump to a metric',
		tocCounterPrefix: 'SEC',
		backToTop: 'Back to top',
		sqlAria: 'Defining SQL for the metric',
		tocPill: {
			open: 'Contents',
			title: 'Jump to a metric',
			close: 'Close contents',
		},
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
