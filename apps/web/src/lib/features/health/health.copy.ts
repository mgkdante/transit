// health.copy.ts — co-located bilingual copy for the /status (data-health) surface.
//
// The /status surface is the full read-out of provenance.json: the data-honesty
// manifest for the historic tier. Where the conformance BADGE shows ~5% of that
// payload, this surface renders the whole thing — per-feed freshness, source
// lineage, declared gaps, retention windows, and the full conformance verdict.
//
// Co-located with HealthStatus.svelte so the screen owns no inline strings.
// Intrinsic component vocabulary (the conformance verdict labels, the edge-state
// copy) already lives inside the spine primitives; this file carries the
// surface-level prose + section captions + the freshness-status verdict labels.
//
// Shape: `Record<Locale, {...}>` with EN + FR. FR is the canonical product voice;
// EN is the parallel translation. PROVIDER-AGNOSTIC: no agency/city literals.

import { defineCopy, type Locale } from '$lib/i18n/copy';
import { articleCopy } from '$lib/components/layout/articleCopy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
	en: {
		kicker: 'DATA · HONESTY',
		article: articleCopy('en', {
			watermark: 'Status',
			tags: ['data', 'feeds', 'freshness', 'known gaps'],
			sections: (n: number) => `${n} ${n === 1 ? 'section' : 'sections'}`,
			dailyAsOf: 'DAILY RECORD AS OF',
			liveAsOf: 'LIVE FEEDS AS OF',
		}),
		heading: 'Data health',
		lede: 'How fresh each source is, where it came from, what is knowingly missing, how long we keep it, and how cleanly the latest schedule matched the model behind this dashboard. A missing signal shows as “no data”, never a fabricated value.',
		overview: {
			title: 'Overview',
			dailyRecord: 'Daily record',
			liveFeeds: 'Live feeds',
			retainedHistory: 'Retained history',
		},
		asOf: 'AS OF',
		freshness: {
			section: 'Feed freshness',
			note: 'The status of each feed’s most recent ingestion run, whether the last load succeeded, failed, or is still running, and how long ago that run was.',
			listLabel: 'Per-feed freshness',
			noAge: 'no age signal',
		},
		sources: {
			section: 'Source feeds',
			note: 'Each feed we loaded, its storage lineage, and when it last landed.',
			listLabel: 'Source-feed lineage',
			chainPrefix: 'Storage chain',
			neverLoaded: 'not yet loaded',
			noChain: 'no lineage recorded',
		},
		gaps: {
			section: 'Known data gaps',
			lede: 'These feeds knowingly carry no data on this tier. We name them rather than imply coverage we do not have:',
			listLabel: 'Declared data gaps',
			tokens: {
				metro_realtime: 'Metro: no realtime feed',
			},
		},
		pipelineNotes: {
			section: 'Pipeline notes',
			note: 'How the pipeline builds the things that have no single metric card of their own, published verbatim from the latest run.',
			listLabel: 'Pipeline methodology notes',
			// One label per un-threaded methodology key. The list iterates the FULL
			// published dict, so a key absent here still renders (its humanized key as
			// the label); these are just the friendlier names for the keys we know.
			labels: {
				history_freeze: 'Closed-period freeze',
				service_time_conversion: 'Service-time conversion',
				alert_text_en: 'English alert text',
				network_no_data: 'Network no-data honesty',
				alert_breakdown: 'Alert breakdown',
				rounding: 'Rounding rule',
				min_n_rate: 'Minimum sample for a rate',
				wilson_z: 'Confidence-interval z-score',
				service_span: 'Service span',
				alert_history_window: 'Alert-history window',
			},
		},
		retention: {
			section: 'Retention',
			note: 'How long detail rows and rolled-up aggregates are kept.',
			detailLabel: 'Detail window',
			aggregateLabel: 'Aggregate window',
			daysUnit: ' days',
		},
		historyCoverage: {
			section: 'Retained history coverage',
			note: 'What is actually published today, family by family and metric by metric. These dates report accrued coverage, not the retention ceiling or a promise that every day exists.',
			tableLabel: 'Published retained-history coverage',
			columns: {
				family: 'Page family',
				window: 'Published window',
				selection: 'How to browse',
				details: 'Coverage details',
			},
			families: {
				alerts: 'Alerts',
				receipts: 'Daily receipts',
				network: 'Network',
				lines: 'Lines',
				stops: 'Stops',
				hotspots: 'Hotspots',
				repeat_offenders: 'Repeat offenders',
			},
			selection: { range: 'Date range', date: 'Single date' },
			aggregation: {
				additive: 'Adds across selected days',
				daily_only: 'Daily points; not combined',
				current_only: 'Current view only; not retained',
			},
			metrics: {
				delay: 'Delay',
				delay_percentiles: 'Delay percentiles',
				vehicles: 'Live vehicles',
				cancellation: 'Cancellations',
				occupancy: 'Crowding',
				service_span: 'Service span',
				skipped_stops: 'Skipped stops',
			},
			unavailable: 'Not published in this history index',
			noCoverage: 'No retained dates reported',
			noGapInventory: 'No gap inventory published',
			noDeclaredGaps: 'No gaps declared',
			familyGaps: 'Family gaps',
			metricCoverage: 'Metric coverage',
			noMetricInventory: 'No per-metric inventory published',
			currentOnlySections: 'Current-only sections',
			currentOnlyNote: 'These parts of the current page are not reconstructed for past dates:',
			currentOnlySectionLabels: {
				identity: 'Identity',
				live_status: 'Live status',
				headway: 'Headway',
				habits: 'Patterns',
				weak_stops: 'Weak stops',
				by_shift: 'By shift',
				by_daytype: 'By day type',
				by_crowding: 'By crowding',
				periods: 'Periods',
				weekday: 'Weekday',
				time_of_day: 'Time of day',
				by_route: 'By route',
			},
		},
		conformance: {
			section: 'Feed conformance',
			note: 'How cleanly the latest schedule payload matched the model the pipeline expects.',
			detailsTitle: 'Unmodelled fields (captured verbatim)',
			extraRowsLabel: 'Extra rows kept',
			membersLabel: 'Fields beyond the standard model',
			membersListLabel: 'Unmodelled feed fields',
		},
		statusVerdict: {
			ok: 'loaded',
			running: 'loading',
			failed: 'load failed',
			unknown: 'unknown',
		},
		lanes: {
			terminal: { title: 'pipeline-lanes', tag: 'BUILD' },
			section: 'Pipeline lanes',
			note: 'Each publishing lane, how long ago it last published, how many files it wrote, and how its last value check turned out. Times are the scheduled cadences, not guarantees.',
			listLabel: 'Publish lanes',
			laneLabel: {
				live: 'Live',
				static: 'Schedule',
				rollup: 'Rollups',
				maintenance: 'Maintenance',
			},
			cadence: {
				live: '30-second operating target; delivery may take longer',
				static: 'daily, 06:00 UTC',
				rollup: 'daily, 07:00 UTC',
			},
			cadenceLabel: 'Cadence',
			filesLabel: 'Files',
			filesCount: (written, total) => `${written} of ${total} files`,
			lastPublishLabel: 'Last publish',
			gateVerdict: {
				pass: 'passed',
				warn: 'warnings',
				fail: 'blocked',
				unknown: 'not checked',
			},
			gateLabel: 'Value check',
			gateExplain:
				'The value check runs before a rollup is published: it verifies the numbers against fixed rules and blocks a bad build from shipping. A warning is noted but does not block.',
			maintenanceLabel: 'Maintenance',
			maintenanceCadence: 'weekly, Sunday 08:00 UTC',
			maintenanceReason:
				'Runs weekly in continuous integration and writes no public heartbeat, so there is nothing to report here.',
			notApplicable: 'not applicable',
		},
		envelope: {
			section: 'Build accountability',
			note: 'Every page carries the stamp of the exact publish run that produced it, plus the contract and methodology versions in force.',
			generationIdLabel: 'Publish run',
			generationIdExplain:
				'The deterministic stamp of the single publish run that produced everything on this page. Two pages sharing this stamp were built from the same run.',
			schemaVersionLabel: 'Contract version',
			methodologyVersionLabel: 'Methodology version',
		},
		noData: 'no data',
		toc: {
			label: 'Jump to a section',
			counterPrefix: 'SEC',
			pill: { open: 'Contents', title: 'Jump to a section', close: 'Close contents' },
		},
		statRail: {
			label: 'At a glance',
			lanes: {
				title: 'Lanes',
				passing: (pass, total) => `${pass} / ${total} passing`,
				worst: (lane) => `worst: ${lane}`,
				allClear: 'all lanes passing',
			},
			feeds: {
				title: 'Feeds',
				fresh: (ok, total) => `${ok} / ${total} fresh`,
			},
		},
		aggregate: {
			title: 'PIPELINE GATE',
			summary: (pass, total) => `${pass} of ${total} lanes passing`,
			worst: (lane) => `worst: ${lane}`,
			allClear: 'all lanes passing',
		},
	},
	fr: {
		kicker: 'DONNÉES · HONNÊTETÉ',
		article: articleCopy('fr', {
			watermark: 'État',
			tags: ['données', 'flux', 'fraîcheur', 'lacunes connues'],
			sections: (n: number) => `${n} ${n === 1 ? 'section' : 'sections'}`,
			dailyAsOf: 'BILAN QUOTIDIEN À JOUR AU',
			liveAsOf: 'FLUX EN DIRECT À JOUR AU',
		}),
		heading: 'Santé des données',
		lede: 'À quel point chaque source est récente, d’où elle vient, ce qui manque sciemment, combien de temps on la garde et à quel point le dernier horaire correspondait au modèle derrière ce tableau de bord. Un signal absent s’affiche « aucune donnée », jamais une valeur fabriquée.',
		overview: {
			title: 'Vue d’ensemble',
			dailyRecord: 'Bilan quotidien',
			liveFeeds: 'Flux en direct',
			retainedHistory: 'Historique conservé',
		},
		asOf: 'À JOUR AU',
		freshness: {
			section: 'Fraîcheur des flux',
			note: 'Le statut de la dernière exécution d’ingestion de chaque flux : si le dernier chargement a réussi, échoué, ou est encore en cours, et il y a combien de temps.',
			listLabel: 'Fraîcheur par flux',
			noAge: 'aucun signal d’âge',
		},
		sources: {
			section: 'Flux sources',
			note: 'Chaque flux chargé, sa lignée de stockage, et quand il a été chargé.',
			listLabel: 'Lignée des flux sources',
			chainPrefix: 'Chaîne de stockage',
			neverLoaded: 'pas encore chargé',
			noChain: 'aucune lignée enregistrée',
		},
		gaps: {
			section: 'Lacunes de données connues',
			lede: 'Ces flux ne portent sciemment aucune donnée sur ce palier. On les nomme plutôt que de laisser croire à une couverture qu’on n’a pas :',
			listLabel: 'Lacunes de données déclarées',
			tokens: {
				metro_realtime: 'Métro : aucun flux temps réel',
			} as Readonly<Record<string, string>>,
		},
		pipelineNotes: {
			section: 'Notes du pipeline',
			note: 'Comment le pipeline construit ce qui n’a pas de fiche-métrique propre, publié tel quel depuis la dernière exécution.',
			listLabel: 'Notes de méthode du pipeline',
			// Une étiquette par clé de méthode non rattachée. La liste parcourt le dict
			// publié au COMPLET : une clé absente ici s’affiche quand même (sa clé
			// humanisée sert d’étiquette) ; voici seulement les noms plus lisibles.
			labels: {
				history_freeze: 'Gel des périodes closes',
				service_time_conversion: 'Conversion des heures de service',
				alert_text_en: 'Texte d’alerte en anglais',
				network_no_data: 'Honnêteté « aucune donnée » du réseau',
				alert_breakdown: 'Répartition des alertes',
				rounding: 'Règle d’arrondi',
				min_n_rate: 'Échantillon minimal pour un taux',
				wilson_z: 'Cote z de l’intervalle de confiance',
				service_span: 'Amplitude de service',
				alert_history_window: 'Fenêtre d’historique des alertes',
			} as Readonly<Record<string, string>>,
		},
		retention: {
			section: 'Conservation',
			note: 'Combien de temps les lignes de détail et les agrégats sont conservés.',
			detailLabel: 'Fenêtre de détail',
			aggregateLabel: 'Fenêtre d’agrégats',
			daysUnit: ' jours',
		},
		historyCoverage: {
			section: 'Couverture de l’historique conservé',
			note: 'Ce qui est réellement publié aujourd’hui, famille par famille et métrique par métrique. Ces dates décrivent la couverture accumulée, pas la limite de conservation ni la promesse que chaque journée existe.',
			tableLabel: 'Couverture publiée de l’historique conservé',
			columns: {
				family: 'Famille de pages',
				window: 'Fenêtre publiée',
				selection: 'Mode de consultation',
				details: 'Détails de couverture',
			},
			families: {
				alerts: 'Alertes',
				receipts: 'Bilans quotidiens',
				network: 'Réseau',
				lines: 'Lignes',
				stops: 'Arrêts',
				hotspots: 'Points chauds',
				repeat_offenders: 'Récidivistes',
			},
			selection: { range: 'Plage de dates', date: 'Date unique' },
			aggregation: {
				additive: 'S’additionne sur les jours choisis',
				daily_only: 'Points quotidiens; non combinés',
				current_only: 'Vue actuelle seulement; non conservée',
			},
			metrics: {
				delay: 'Retard',
				delay_percentiles: 'Percentiles de retard',
				vehicles: 'Véhicules en direct',
				cancellation: 'Annulations',
				occupancy: 'Achalandage',
				service_span: 'Amplitude de service',
				skipped_stops: 'Arrêts sautés',
			},
			unavailable: 'Non publiée dans cet index historique',
			noCoverage: 'Aucune date conservée signalée',
			noGapInventory: 'Aucun inventaire des lacunes publié',
			noDeclaredGaps: 'Aucune lacune déclarée',
			familyGaps: 'Lacunes de la famille',
			metricCoverage: 'Couverture par métrique',
			noMetricInventory: 'Aucun inventaire par métrique publié',
			currentOnlySections: 'Sections limitées au présent',
			currentOnlyNote:
				'Ces parties de la page actuelle ne sont pas reconstruites pour les dates passées :',
			currentOnlySectionLabels: {
				identity: 'Identité',
				live_status: 'État en direct',
				headway: 'Intervalle',
				habits: 'Habitudes',
				weak_stops: 'Arrêts faibles',
				by_shift: 'Par quart',
				by_daytype: 'Par type de jour',
				by_crowding: 'Par achalandage',
				periods: 'Périodes',
				weekday: 'Jour de semaine',
				time_of_day: 'Moment de la journée',
				by_route: 'Par ligne',
			} as Readonly<Record<string, string>>,
		},
		conformance: {
			section: 'Conformité du flux',
			note: 'À quel point le dernier horaire correspondait au modèle attendu par le pipeline.',
			detailsTitle: 'Champs non modélisés (conservés tels quels)',
			extraRowsLabel: 'Lignes supplémentaires conservées',
			membersLabel: 'Champs hors du modèle standard',
			membersListLabel: 'Champs de flux non modélisés',
		},
		statusVerdict: {
			ok: 'chargé',
			running: 'en cours',
			failed: 'échec du chargement',
			unknown: 'inconnu',
		},
		lanes: {
			terminal: { title: 'voies-du-pipeline', tag: 'CONSTRUCTION' },
			section: 'Voies du pipeline',
			note: 'Chaque voie de publication, il y a combien de temps elle a publié pour la dernière fois, combien de fichiers elle a écrits, et le résultat de sa dernière vérification des valeurs. Les heures sont les cadences prévues, pas des garanties.',
			listLabel: 'Voies de publication',
			laneLabel: {
				live: 'Temps réel',
				static: 'Horaire',
				rollup: 'Agrégats',
				maintenance: 'Maintenance',
			} as Readonly<Record<string, string>>,
			cadence: {
				live: 'cible d’exploitation de 30 secondes; l’affichage peut prendre plus de temps',
				static: 'chaque jour, 06:00 UTC',
				rollup: 'chaque jour, 07:00 UTC',
			} as Readonly<Record<string, string>>,
			cadenceLabel: 'Cadence',
			filesLabel: 'Fichiers',
			filesCount: (written: string, total: string) => `${written} sur ${total} fichiers`,
			lastPublishLabel: 'Dernière publication',
			gateVerdict: {
				pass: 'réussie',
				warn: 'avertissements',
				fail: 'bloquée',
				unknown: 'non vérifiée',
			},
			gateLabel: 'Vérification des valeurs',
			gateExplain:
				'La vérification des valeurs s’exécute avant la publication d’un agrégat : elle contrôle les nombres selon des règles fixes et empêche une mauvaise version de partir. Un avertissement est noté mais ne bloque pas.',
			maintenanceLabel: 'Maintenance',
			maintenanceCadence: 'chaque semaine, dimanche 08:00 UTC',
			maintenanceReason:
				'S’exécute chaque semaine en intégration continue et n’écrit aucun battement public, il n’y a donc rien à rapporter ici.',
			notApplicable: 'sans objet',
		},
		envelope: {
			section: 'Traçabilité de la version',
			note: 'Chaque page porte l’empreinte de l’exécution de publication exacte qui l’a produite, ainsi que les versions du contrat et de la méthode en vigueur.',
			generationIdLabel: 'Exécution de publication',
			generationIdExplain:
				'L’empreinte déterministe de l’unique exécution de publication qui a produit tout ce qui figure sur cette page. Deux pages partageant cette empreinte proviennent de la même exécution.',
			schemaVersionLabel: 'Version du contrat',
			methodologyVersionLabel: 'Version de la méthode',
		},
		noData: 'aucune donnée',
		toc: {
			label: 'Aller à une section',
			counterPrefix: 'SEC',
			pill: { open: 'Sommaire', title: 'Aller à une section', close: 'Fermer le sommaire' },
		},
		statRail: {
			label: 'En bref',
			lanes: {
				title: 'Lignes',
				passing: (pass: string, total: string) => `${pass} / ${total} conformes`,
				worst: (lane: string) => `pire : ${lane}`,
				allClear: 'toutes les lignes conformes',
			},
			feeds: {
				title: 'Flux',
				fresh: (ok: string, total: string) => `${ok} / ${total} à jour`,
			},
		},
		aggregate: {
			title: 'GATE PIPELINE',
			summary: (pass: string, total: string) => `${pass} lignes conformes sur ${total}`,
			worst: (lane: string) => `pire : ${lane}`,
			allClear: 'toutes les lignes conformes',
		},
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type HealthCopy = (typeof copy)[Locale];
