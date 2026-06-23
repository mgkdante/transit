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
	/**
	 * The "Live vehicle positions — almost real-time, not real-time" card. A clear,
	 * detailed, honest explainer of how the live map DRAWS moving buses: the ~20-60s
	 * GTFS-RT reporting cadence, what "Almost real-time" (smooth forward-projection)
	 * means as a bounded, decaying ESTIMATE between reports, how a stale bus FREEZES
	 * with a big "!" instead of being faked into motion, what "Raw" (measured only)
	 * shows, and why both modes exist (honest-by-design; a proper prediction engine
	 * is planned). Renders on the same collapsible-card spine as the metric sections.
	 */
	readonly livePositions: {
		/** ToC + card title. */
		readonly title: string;
		/** Lede paragraph framing the whole card. */
		readonly lede: string;
		/** The named sub-points; each a heading + plain-language body. */
		readonly points: ReadonlyArray<{ readonly heading: string; readonly body: string }>;
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
		/**
		 * The paired "remember" pin (slice-9.8-B). FOCUS is session-only by default;
		 * the pin promotes the preference to be remembered across visits.
		 */
		/** Visible label for the remember pin (mono control voice). */
		readonly rememberLabel: string;
		/** aria-label / title when the pin is OFF (the action the press performs: pin it). */
		readonly remember: string;
		/** aria-label / title when the pin is ON (the action the press performs: unpin it). */
		readonly forget: string;
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
		livePositions: {
			title: 'Positions des véhicules en direct, presque en temps réel, pas en temps réel',
			lede: 'Sur la carte en direct, chaque bus est dessiné à partir du flux GTFS temps réel en direct. Mais ce flux n’est pas continu : voici, honnêtement, comment la carte décide où dessiner un bus entre deux relevés, et le choix que vous contrôlez avec le bouton « Mouvement ».',
			points: [
				{
					heading: 'Un relevé de position arrive seulement toutes les ~20 à 60 secondes',
					body: 'La position GPS d’un bus n’arrive pas en continu : le flux publie un nouveau relevé seulement toutes les ~20 à 60 secondes, pas à chaque instant. Entre deux relevés, nous n’avons AUCUNE mesure réelle de l’endroit où se trouve le bus. Tout ce qui s’affiche entre les relevés est donc soit l’ancienne position figée, soit une estimation. Jamais une nouvelle mesure.',
				},
				{
					heading: '« Presque en temps réel » = on estime la position entre les relevés',
					body: 'En mode « Presque en temps réel », entre deux relevés nous ESTIMONS où le bus se trouve le plus probablement en le projetant VERS L’AVANT le long de sa ligne, à la dernière vitesse qu’il a signalée. C’est une estimation bornée et décroissante : on fait confiance à un relevé frais brièvement, puis on arrête d’inventer du déplacement, et le prochain relevé réel corrige la position. C’est une APPROXIMATION, pas une mesure. Admettons-le franchement : c’est plus fluide à regarder, mais ce n’est pas la vérité GPS.',
				},
				{
					heading: 'Un bus qui ne répond plus FIGE et porte un grand « ! »',
					body: 'Si un bus n’a pas signalé sa position depuis un moment, on ne fait JAMAIS semblant qu’il bouge encore. Il FIGE à son dernier emplacement connu et reçoit un grand « ! » bien visible, pour que vous sachiez d’un coup d’œil que sa position n’est plus fraîche. On préfère un bus immobile honnête à un bus inventé en mouvement.',
				},
				{
					heading: '« Brut » = uniquement les positions mesurées',
					body: 'En mode « Brut » (le mode par défaut), on n’affiche QUE les positions réellement mesurées : à chaque mise à jour du flux (~30 s), chaque bus saute directement à son dernier emplacement signalé, sans aucune estimation entre les deux. C’est plus saccadé, mais c’est la vérité non embellie, chaque point est une vraie mesure, jamais une supposition.',
				},
				{
					heading: 'Pourquoi les deux modes',
					body: 'Le mode fluide est plus agréable à regarder, mais c’est une estimation; le mode brut est la vérité brute, à vous de choisir. C’est honnête par conception : on ne vous cache pas l’approximation, on vous laisse la voir ou l’éteindre. Le mouvement reste un peu en retard pour l’instant; un véritable moteur de prédiction est prévu pour la suite.',
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
			rememberLabel: 'Mémoriser',
			remember: 'Mémoriser le mode lecture pour les prochaines visites',
			forget: 'Oublier le mode lecture (cette session seulement)',
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
		livePositions: {
			title: 'Live vehicle positions, almost real-time, not real-time',
			lede: 'On the live map, every bus is drawn from the live GTFS-realtime feed. But that feed is not continuous: here, honestly, is how the map decides where to draw a bus between reports, and the choice you control with the “Motion” switch.',
			points: [
				{
					heading: 'Each bus reports its position only every ~20-60 seconds',
					body: 'A bus’s GPS position does not arrive continuously: the feed publishes a fresh report only every ~20-60 seconds, not every moment. Between reports we have NO real measurement of where the bus is. So anything shown between reports is either the old position held still, or an estimate, never a new measurement.',
				},
				{
					heading: '“Almost real-time” = we estimate the position between reports',
					body: 'In “Almost real-time” mode, between reports we ESTIMATE where a bus most likely is by projecting it FORWARD along its route at its last reported speed. It is a bounded, decaying estimate: we trust a fresh fix briefly, then stop inventing travel, and the next real report corrects it. It is an APPROXIMATION, not a measurement. Said plainly: it is smoother to watch, but it is not GPS truth.',
				},
				{
					heading: 'A bus that has not reported in a while FREEZES and gets a big “!”',
					body: 'If a bus has not reported its position in a while, we NEVER pretend it is still moving. It FREEZES at its last known spot and gets a big, visible “!” so you can tell at a glance that its position is no longer fresh. We would rather show an honest stationary bus than a faked moving one.',
				},
				{
					heading: '“Raw” = measured positions only',
					body: 'In “Raw” mode (the default), we show ONLY positions that were actually measured: on every ~30s feed update each bus jumps straight to its last reported location, with no estimation in between. It is choppier, but it is the unembellished truth, every dot is a real measurement, never a guess.',
				},
				{
					heading: 'Why both modes',
					body: 'Smooth is easier to watch but is an estimate; raw is the unembellished truth, you choose. This is honest by design: we do not hide the approximation from you, we let you see it or switch it off. The motion is still a touch laggy for now; a proper prediction engine is planned next.',
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
			rememberLabel: 'Remember',
			remember: 'Remember focus reading on future visits',
			forget: 'Forget focus reading (this session only)',
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
