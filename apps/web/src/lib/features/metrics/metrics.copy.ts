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

import { defineCopy, type Locale } from '$lib/i18n/copy';
import { articleCopy } from '$lib/components/layout/articleCopy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const metricsCopy = defineCopy({
	fr: {
		kicker: 'MÉTHODE · SCIENCE DES MESURES',
		heading: 'Comment on mesure',
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
			label: 'Sources et populations',
			body: 'Les mesures dérivent des horaires GTFS, des prédictions GTFS-RT, des positions de véhicules et des avis. Les statistiques historiques de retard comptent des observations, y compris les mises à jour répétées. En direct, la ponctualité et la couverture décrivent les positions admissibles sur la carte; les percentiles donnent le même poids au retard moyen de chaque trajet. Les définitions précisent la population et la fenêtre de chaque indicateur. Ces données ne mesurent pas directement les arrivées aux arrêts ni le nombre de voyageurs. Un dénominateur absent reste inconnu.',
			unavailable:
				'Le verdict de conformité du flux n’a pas pu être chargé pour l’instant. La méthodologie ci-dessous reste exacte et complète; seule cette vérification en direct est momentanément indisponible.',
			howWeMeasure: {
				label: 'Comment on mesure (vaut pour chaque métrique)',
				serviceDay: {
					heading: 'Jour de capture ou jour de service',
					body: 'Les résumés historiques de retard utilisent le jour local de capture du fournisseur. Les comptes et plages de service gardent le jour de service GTFS. Les heures d’horaire peuvent dépasser 24:00 : ce sont des durées écoulées depuis midi local moins 12 heures. Les mesures en direct décrivent l’instantané courant; chaque famille conserve sa propre fenêtre et ses limites.',
				},
				confidenceInterval: {
					heading: 'Lire un intervalle de confiance',
					body: 'La méthode de Wilson vise une couverture d’environ 95 % sur des échantillons répétés, avec des observations indépendantes et une probabilité de ponctualité stable. Les mises à jour d’un même trajet peuvent être corrélées. Ces intervalles ne corrigent pas cette dépendance et peuvent sous-estimer l’incertitude.',
					link: 'Méthode et limites',
					reference: 'Intervalle de Wilson : référence NIST',
				},
				rounding: {
					heading: 'Arrondi et versions',
					body: 'À égalité exacte, les valeurs arrondies s’éloignent de zéro : 2,55 devient 2,6 et −2,55 devient −2,6 à une décimale. Les versions de méthodologie live-2, reliability-2 et alerts-2 appliquent cette règle aux métriques publiées. Les anciens fichiers de version 1 conservent leurs valeurs, qui peuvent utiliser un arrondi au pair. Vérifiez la version pour reproduire un résultat. Les classes du réseau en direct portent toujours sur les retards moyens par trajet arrondis à la minute.',
				},
				constants: {
					heading: 'Constantes de la doctrine',
					body: (minN: string, wilsonZ: string) =>
						`Seuil « assez fiable » = ${minN} relevés à retard connu (min_n_rate) : sous ce seuil, un taux garde son observation_count brut mais est signalé peu fiable, jamais supprimé. Intervalle de confiance = score de Wilson à 95 %, z = ${wilsonZ} (wilson_z). Ces deux valeurs sont lues telles quelles depuis provenance.methodology de l’exécution en cours, pas codées en dur.`,
					absent:
						'Les constantes de la doctrine (min_n_rate, z de Wilson) sont lues depuis provenance.methodology de l’exécution en cours; ce document n’a pas pu être chargé pour l’instant, donc leurs valeurs exactes ne sont pas affichées ici. La méthodologie ci-dessous reste exacte.',
				},
			},
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
					body: 'Le mode fluide estime le déplacement entre les mises à jour du flux. Le mode brut affiche les positions rapportées. Vous pouvez changer de mode à tout moment.',
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
		article: articleCopy('fr', {
			watermark: 'Méthode',
			tags: ['mesure', 'ponctualité', 'retards', 'calcul honnête', 'données ouvertes'],
		}),
		statRail: {
			label: 'En bref',
			provenance: {
				title: 'Provenance',
				unavailable: 'Vérification de conformité momentanément indisponible.',
			},
			coverage: {
				title: 'Couverture',
				metrics: 'métriques',
				families: 'familles',
			},
			freshness: { title: 'Fraîcheur' },
		},
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
			trigger: (name: string) => `À propos de ${name}`,
			link: 'Comment c’est mesuré',
		},
	},
	en: {
		kicker: 'METHODOLOGY · METRIC SCIENCE',
		heading: 'How we measure',
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
			label: 'Sources and populations',
			body: 'The measures derive from GTFS schedules, GTFS-RT predictions, vehicle positions and alerts. Historical delay statistics count observations, including repeated updates. Live punctuality and coverage describe map-eligible vehicle positions; live percentiles give each current trip-average delay equal weight. Each definition states its population and window. These data do not directly measure arrivals at stops or passenger counts. An unavailable denominator remains unknown.',
			unavailable:
				'The live feed-conformance verdict could not be loaded right now. The methodology below is still exact and complete; only this live check is momentarily unavailable.',
			howWeMeasure: {
				label: 'How we measure (applies to every metric)',
				serviceDay: {
					heading: 'Capture day vs service day',
					body: 'Historical delay summaries use the provider-local capture day. Service counts and spans retain the GTFS service day. Schedule times can exceed 24:00: they are elapsed durations from local noon minus 12 hours. Live measures describe the current snapshot; each family retains its own window and coverage limits.',
				},
				confidenceInterval: {
					heading: 'Reading a confidence interval',
					body: 'The Wilson method aims for about 95% coverage across repeated samples with independent observations and a stable on-time probability. Updates from the same trip can be correlated. These intervals do not adjust for that dependence and can understate uncertainty.',
					link: 'Method and limits',
					reference: 'Wilson interval: NIST reference',
				},
				rounding: {
					heading: 'Rounding and versions',
					body: 'At an exact tie, rounded values move away from zero: 2.55 becomes 2.6 and −2.55 becomes −2.6 at one decimal place. Methodology versions live-2, reliability-2 and alerts-2 apply this rule to published metrics. Older version-1 files retain their values, which may use ties-to-even rounding. Check the methodology version when reproducing a result. Live network histogram bins still classify trip-average delays rounded to whole minutes.',
				},
				constants: {
					heading: 'Doctrine constants',
					body: (minN, wilsonZ) =>
						`“Reliable enough” = ${minN} known-delay observations (min_n_rate): below it, a rate keeps its raw observation_count but is flagged low-confidence, never suppressed. Confidence interval = the 95% Wilson score interval, z = ${wilsonZ} (wilson_z). Both values are read as-is from the current run’s provenance.methodology, not hardcoded.`,
					absent:
						'The doctrine constants (min_n_rate, Wilson z) are read from the current run’s provenance.methodology; that document could not be loaded right now, so their exact values are not shown here. The methodology below is still exact.',
				},
			},
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
					body: 'Smooth mode estimates motion between feed updates. Raw mode shows the reported positions. You can switch between them at any time.',
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
		article: articleCopy('en', {
			watermark: 'Method',
			tags: ['measure', 'on-time', 'delays', 'honest math', 'open data'],
		}),
		statRail: {
			label: 'At a glance',
			provenance: {
				title: 'Provenance',
				unavailable: 'Conformance check momentarily unavailable.',
			},
			coverage: {
				title: 'Coverage',
				metrics: 'metrics',
				families: 'families',
			},
			freshness: { title: 'Freshness' },
		},
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
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type MetricsCopy = (typeof metricsCopy)[Locale];
