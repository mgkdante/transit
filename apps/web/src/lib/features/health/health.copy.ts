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

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface HealthCopy extends SurfaceHeadCopy {
	readonly lede: string;
	/** Shared yesid-style article header copy for /status. */
	readonly article: {
		readonly watermark: string;
		readonly back: string;
		readonly tagsAria: string;
		readonly tags: readonly string[];
		readonly sections: (count: number) => string;
		/** Source labels used only when the daily and live documents have different stamps. */
		readonly dailyAsOf: string;
		readonly liveAsOf: string;
	};
	/** "as of" label preceding the generated-at article meta. */
	readonly asOf: string;
	/** Per-feed freshness table. */
	readonly freshness: {
		/** Section caption. */
		readonly section: string;
		/** Short caption under the section label. */
		readonly note: string;
		/** Accessible label for the whole freshness list. */
		readonly listLabel: string;
		/** Shown when age_s is null (no age signal for a feed). */
		readonly noAge: string;
	};
	/** Source-feeds / lineage list. */
	readonly sources: {
		readonly section: string;
		readonly note: string;
		/** Accessible label for the lineage list. */
		readonly listLabel: string;
		/** Prefix read before a chain string (a11y). */
		readonly chainPrefix: string;
		/** Shown when last_loaded_utc is null. */
		readonly neverLoaded: string;
		/** Shown when chain is null/absent. */
		readonly noChain: string;
	};
	/** Known-data-gaps honesty banner. */
	readonly gaps: {
		readonly section: string;
		/** Lede sentence above the gap list. */
		readonly lede: string;
		/** Accessible label for the gaps list. */
		readonly listLabel: string;
		/**
		 * Localized human sentences for known gap[] feed tokens (the raw payload
		 * carries terse tokens like `metro_realtime`). A token absent here falls
		 * back to its humanized form (underscores → spaces) at the call site.
		 */
		readonly tokens: Readonly<Record<string, string>>;
	};
	/**
	 * Pipeline notes: the methodology[] strings NOT threaded into a /metrics card.
	 * provenance.methodology publishes more notes than there are citizen metrics;
	 * the surplus (history_freeze, service_time_conversion, alert_text_en,
	 * network_no_data, alert_breakdown) lands here so EVERY published string
	 * renders somewhere. Stands DOWN when none of these keys are present.
	 */
	readonly pipelineNotes: {
		readonly section: string;
		/** Short caption under the section label. */
		readonly note: string;
		/** Accessible label for the notes list. */
		readonly listLabel: string;
		/** Human label per un-threaded methodology key (the verbatim string follows). */
		readonly labels: Readonly<Record<string, string>>;
	};
	/** Retention stat pair. */
	readonly retention: {
		readonly section: string;
		readonly note: string;
		/** Metric label for the detail-window stat. */
		readonly detailLabel: string;
		/** Metric label for the aggregate-window stat. */
		readonly aggregateLabel: string;
		/** Unit suffix appended to a day count (e.g. " days"). */
		readonly daysUnit: string;
	};
	/** Conformance section (full verdict + unknown-member list). */
	readonly conformance: {
		readonly section: string;
		readonly note: string;
		/** Collapsible card title for the full unknown-member list. */
		readonly detailsTitle: string;
		/** Metric label for the exact extra-row count. */
		readonly extraRowsLabel: string;
		/** Caption above the unknown-member list. */
		readonly membersLabel: string;
		/** Accessible label for the unknown-member list. */
		readonly membersListLabel: string;
	};
	/**
	 * Localized freshness-status verdict labels, keyed by the verdict bucket the
	 * screen derives from the run status (`succeeded`/`failed`/`running`/…) +
	 * `age_s`. `ok` = last load succeeded; `failed` = last load failed;
	 * `running` = a load is in flight; `unknown` = no status reported.
	 */
	readonly statusVerdict: {
		readonly ok: string;
		readonly running: string;
		readonly failed: string;
		readonly unknown: string;
	};
	/**
	 * Pipeline-lanes section (S11): one row per publish lane (live / static /
	 * rollup) with last-publish age + file counts + the last value-gate verdict,
	 * plus the MAINTENANCE honest not-applicable row (no public heartbeat).
	 */
	readonly lanes: {
		/** D3: the TerminalPanel framing the pipeline-lanes board. */
		readonly terminal: { readonly title: string; readonly tag: string };
		readonly section: string;
		/** Short caption under the section label. */
		readonly note: string;
		/** Accessible label for the lanes list. */
		readonly listLabel: string;
		/** lane key → localized lane label. */
		readonly laneLabel: Readonly<Record<string, string>>;
		/** lane key → localized scheduled-cadence line (stated as a schedule, not a promise). */
		readonly cadence: Readonly<Record<string, string>>;
		/** Caption before the "as scheduled" cadence line (a11y + label). */
		readonly cadenceLabel: string;
		/** Caption before the file counts (written / total). */
		readonly filesLabel: string;
		/** Formats a "{written} of {total} files" count line. */
		readonly filesCount: (written: string, total: string) => string;
		/** Caption before the last-publish age. */
		readonly lastPublishLabel: string;
		/** Localized gate-verdict words (map to the status chip tone). */
		readonly gateVerdict: {
			readonly pass: string;
			readonly warn: string;
			readonly fail: string;
			readonly unknown: string;
		};
		/** Caption before the gate chip. */
		readonly gateLabel: string;
		/**
		 * One-line explanation of WHAT the gate is (honest, not alarmist): value-level
		 * checks that BLOCK a bad historic publish. Shown once beside the lanes list.
		 */
		readonly gateExplain: string;
		/** The MAINTENANCE not-applicable row copy. */
		readonly maintenanceLabel: string;
		readonly maintenanceCadence: string;
		readonly maintenanceReason: string;
		/** Chip word for the not-applicable lane (no heartbeat). */
		readonly notApplicable: string;
	};
	/**
	 * Accountability-envelope section (S11): the deterministic publish stamp +
	 * schema/methodology versions every payload carries, surfaced so the reader can
	 * cite the exact build.
	 */
	readonly envelope: {
		readonly section: string;
		readonly note: string;
		/** publish_generation_id — label + always-visible explanation (ExplainedMetricCard). */
		readonly generationIdLabel: string;
		readonly generationIdExplain: string;
		/** schema_version — MetricDisplay row label. */
		readonly schemaVersionLabel: string;
		/** methodology_version — MetricDisplay row label. */
		readonly methodologyVersionLabel: string;
	};
	/** Shown when a contract value is absent (honest no-data, never fabricated). */
	readonly noData: string;
	/**
	 * Left-rail ToC (P5.4c DetailShell re-seat) — heading + SEC counter prefix +
	 * mobile-pill a11y strings. The entry titles reuse each section's own caption.
	 */
	readonly toc: {
		readonly label: string;
		readonly counterPrefix: string;
		readonly pill: { readonly open: string; readonly title: string; readonly close: string };
	};
	/**
	 * Right-rail stat cards (P5.3b) — a compact pass/fail summary built from data on
	 * the page: lanes passing over total (+ worst lane) and feeds fresh over total.
	 * Reflows into the mobile top strip.
	 */
	readonly statRail: {
		/** Accessible label for the whole stat rail (aside). */
		readonly label: string;
		/** Lanes card: title + "{pass} / {total}" pass-summary + "worst: {lane}" line. */
		readonly lanes: {
			readonly title: string;
			readonly passing: (pass: string, total: string) => string;
			readonly worst: (lane: string) => string;
			readonly allClear: string;
		};
		/** Feeds card: title + "{ok} / {total}" fresh-summary. */
		readonly feeds: {
			readonly title: string;
			readonly fresh: (ok: string, total: string) => string;
		};
	};
	/**
	 * Aggregate lane-gate verdict TerminalPanel (§C5.9) — the FIRST thing the page
	 * says, before the section ledger: "N/M lanes passing" + the worst lane.
	 */
	readonly aggregate: {
		/** TerminalPanel title (mono, --text-micro). */
		readonly title: string;
		/** The pass-summary sentence ("{pass} of {total} lanes passing"). */
		readonly summary: (pass: string, total: string) => string;
		/** Trailing "worst: {lane}" clause when a lane is failing. */
		readonly worst: (lane: string) => string;
		/** Shown in place of the worst clause when every applicable lane passes. */
		readonly allClear: string;
	};
}

export const copy: Record<Locale, HealthCopy> = {
	en: {
		kicker: 'DATA · HONESTY',
		article: {
			watermark: 'Status',
			back: '← Back to the dashboard',
			tagsAria: 'Page keywords',
			tags: ['data', 'feeds', 'freshness', 'known gaps'],
			sections: (n) => `${n} ${n === 1 ? 'section' : 'sections'}`,
			dailyAsOf: 'DAILY RECORD AS OF',
			liveAsOf: 'LIVE FEEDS AS OF',
		},
		heading: 'Data health',
		lede: 'How fresh each source is, where it came from, what is knowingly missing, how long we keep it, and how cleanly the latest schedule matched the model behind this dashboard. A missing signal shows as “no data”, never a fabricated value.',
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
				live: 'every ~57 seconds',
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
		article: {
			watermark: 'État',
			back: '← Retour au tableau de bord',
			tagsAria: 'Mots-clés de la page',
			tags: ['données', 'flux', 'fraîcheur', 'lacunes connues'],
			sections: (n) => `${n} ${n === 1 ? 'section' : 'sections'}`,
			dailyAsOf: 'BILAN QUOTIDIEN À JOUR AU',
			liveAsOf: 'FLUX EN DIRECT À JOUR AU',
		},
		heading: 'Santé des données',
		lede: 'À quel point chaque source est récente, d’où elle vient, ce qui manque sciemment, combien de temps on la garde et à quel point le dernier horaire correspondait au modèle derrière ce tableau de bord. Un signal absent s’affiche « aucune donnée », jamais une valeur fabriquée.',
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
			},
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
			},
		},
		retention: {
			section: 'Conservation',
			note: 'Combien de temps les lignes de détail et les agrégats sont conservés.',
			detailLabel: 'Fenêtre de détail',
			aggregateLabel: 'Fenêtre d’agrégats',
			daysUnit: ' jours',
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
			},
			cadence: {
				live: 'toutes les ~57 secondes',
				static: 'chaque jour, 06:00 UTC',
				rollup: 'chaque jour, 07:00 UTC',
			},
			cadenceLabel: 'Cadence',
			filesLabel: 'Fichiers',
			filesCount: (written, total) => `${written} sur ${total} fichiers`,
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
				passing: (pass, total) => `${pass} / ${total} conformes`,
				worst: (lane) => `pire : ${lane}`,
				allClear: 'toutes les lignes conformes',
			},
			feeds: {
				title: 'Flux',
				fresh: (ok, total) => `${ok} / ${total} à jour`,
			},
		},
		aggregate: {
			title: 'GATE PIPELINE',
			summary: (pass, total) => `${pass} lignes conformes sur ${total}`,
			worst: (lane) => `pire : ${lane}`,
			allClear: 'toutes les lignes conformes',
		},
	},
};
