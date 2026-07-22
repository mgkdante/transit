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

import { defineCopy, type Locale } from '$lib/i18n/copy';
import { SEVERITY_LABELS } from '$lib/v1/enumLabels';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const alertHistoryCopy = defineCopy({
	fr: {
		kicker: 'AVIS · ARCHIVE',
		heading: 'Avis',
		subheading: '// HISTORIQUE',
		lede: 'Les avis de service passés, du plus récent au plus ancien, avec leur durée et leur portée. On n’invente jamais de données : un champ absent reste absent.',
		article: {
			watermark: 'Avis',
			back: '← Retour au tableau de bord',
			tagsAria: 'Mots-clés de la page',
			tags: ['avis', 'archive', 'durée', 'portée'],
			matches: (count: number) =>
				`${count.toLocaleString('fr-CA')} résultat${count === 1 ? '' : 's'}`,
			sections: (count: number) =>
				`${count.toLocaleString('fr-CA')} section${count === 1 ? '' : 's'}`,
		},
		asOf: 'À JOUR AU',
		rail: {
			label: 'Filtres et sommaire',
			open: 'Ouvrir les filtres et le sommaire',
			close: 'Fermer les filtres et le sommaire',
			toc: 'Sur cette page',
			counterPrefix: 'SEC',
		},
		cards: {
			window: {
				title: 'Avis dans la fenêtre',
				subtitle: 'Les avis correspondants et leur durée médiane de résolution',
			},
			breakdown: {
				title: 'Répartition',
				subtitle: 'Les causes, effets et gravités des avis correspondants',
			},
			log: {
				title: 'Avis passés',
				subtitle: 'L’archive des avis correspondants, du plus récent au plus ancien',
			},
		},
		logSection: 'Avis passés',
		logListLabel: 'Avis de service passés, du plus récent au plus ancien',
		count: (shown: number, total: number) => `${shown} sur ${total} avis affichés`,
		more: (n: number) => `+${n} de plus`,
		showLess: 'Réduire',
		empty: 'Aucun avis de service archivé pour le moment.',
		truncatedNote: (shown: number, total: number) =>
			`Fenêtre plafonnée : ${shown} avis les plus récents sur ${total} au total ; les décomptes et la répartition reflètent seulement ces avis.`,
		archivePreviewNote: (shown: number) =>
			`Chargement de la fenêtre complète. Affichage temporaire des ${shown} avis les plus récents ; les décomptes et la répartition seront mis à jour.`,
		meta: {
			from: 'À partir de',
			until: 'Jusqu’à',
			duration: 'Durée',
			durationValue: (min: number) => `${min} min`,
			routes: 'Lignes touchées',
			stops: 'Arrêts touchés',
			impact: 'Passages touchés (est.)',
			impactValue: (passages: number) => `${passages.toLocaleString('fr-CA')} passages`,
			windows: 'Fenêtres de service',
			windowsCount: (n: number) => `${n} fenêtres de service`,
			link: 'Détails',
			linkAria: (host: string) => `Ouvrir les détails de l’avis sur ${host} (nouvel onglet)`,
		},
		severity: SEVERITY_LABELS.fr,
		filters: {
			railLabel: 'Filtres',
			pillOpen: 'Ouvrir les filtres',
			pillClose: 'Fermer les filtres',
			pillSummary: (matchCount: number) => `${matchCount.toLocaleString('fr-CA')} avis`,
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
			history: {
				navigator: {
					group: 'Plage de l’historique des avis',
					picker: {
						group: 'Plage de l’historique des avis',
						start: 'Du',
						end: 'Au',
						clear: 'Revenir à la période courante',
						anyStart: 'Au plus tôt',
						anyEnd: 'Au plus tard',
					},
					previous: 'Période précédente',
					next: 'Période suivante',
				},
				coverage: (from: string, to: string) => `Archives : du ${from} au ${to}`,
				selection: (from: string, to: string) => `Sélection : du ${from} au ${to}`,
				correction: {
					malformed: 'La plage de dates invalide a été remplacée par la période courante.',
					'outside-coverage':
						'La plage de dates non disponible a été remplacée par la période courante.',
					gap: 'La plage dans une lacune des archives a été remplacée par la période courante.',
					unpublished: 'La plage non publiée a été remplacée par la période courante.',
				},
			},
			noMatch: 'Aucun avis ne correspond aux filtres sélectionnés.',
			summary: {
				fr: { singular: '{count} avis', plural: '{count} avis' },
				en: { singular: '{count} alert', plural: '{count} alerts' },
			},
		},
		headline: {
			label: 'Avis dans la fenêtre',
			value: (count: number) => count.toLocaleString('fr-CA'),
			explanation:
				'Le nombre d’avis de service actifs dans la plage de dates choisie, avec leur durée médiane. On compte les avis distincts, jamais une estimation.',
			median: (min: number) => `durée médiane ${min} min`,
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
			buckets: (count: number) => `${count.toLocaleString('fr-CA')} avis`,
			median: (min: number) => `durée médiane ${min} min`,
			unspecified: 'Non précisé',
		},
	},
	en: {
		kicker: 'ALERTS · ARCHIVE',
		heading: 'Alerts',
		subheading: '// HISTORY',
		lede: 'Past service alerts, newest first, with their duration and reach. We never invent data: an absent field stays absent.',
		article: {
			watermark: 'Alerts',
			back: '← Back to the dashboard',
			tagsAria: 'Page keywords',
			tags: ['alerts', 'archive', 'duration', 'reach'],
			matches: (count) => `${count.toLocaleString('en-CA')} ${count === 1 ? 'match' : 'matches'}`,
			sections: (count) =>
				`${count.toLocaleString('en-CA')} ${count === 1 ? 'section' : 'sections'}`,
		},
		asOf: 'AS OF',
		rail: {
			label: 'Filters & contents',
			open: 'Open filters and contents',
			close: 'Close filters and contents',
			toc: 'On this page',
			counterPrefix: 'SEC',
		},
		cards: {
			window: {
				title: 'Alerts in window',
				subtitle: 'Matching alerts and their median resolved duration',
			},
			breakdown: {
				title: 'Breakdown',
				subtitle: 'Cause, effect, and severity across the matching alerts',
			},
			log: {
				title: 'Past alerts',
				subtitle: 'The matching alert archive, newest first',
			},
		},
		logSection: 'Past alerts',
		logListLabel: 'Past service alerts, newest first',
		count: (shown, total) => `Showing ${shown} of ${total} alerts`,
		more: (n) => `+${n} more`,
		showLess: 'Show less',
		empty: 'No archived service alerts yet.',
		truncatedNote: (shown, total) =>
			`Window capped: showing the ${shown} most recent of ${total} alerts; counts and the breakdown reflect only these.`,
		archivePreviewNote: (shown) =>
			`Loading the complete selected range. Showing the latest ${shown} ${shown === 1 ? 'alert' : 'alerts'} for now; counts and the breakdown will update.`,
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
			pillOpen: 'Open filters',
			pillClose: 'Close filters',
			pillSummary: (matchCount) => `${matchCount.toLocaleString('en-CA')} alerts`,
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
			history: {
				navigator: {
					group: 'Alert history range',
					picker: {
						group: 'Alert history range',
						start: 'From',
						end: 'To',
						clear: 'Return to current window',
						anyStart: 'Earliest',
						anyEnd: 'Latest',
					},
					previous: 'Previous range',
					next: 'Next range',
				},
				coverage: (from, to) => `Archive coverage: ${from} to ${to}`,
				selection: (from, to) => `Selected: ${from} to ${to}`,
				correction: {
					malformed: 'The invalid date range was reset to the current window.',
					'outside-coverage': 'The unavailable date range was reset to the current window.',
					gap: 'The range in an archive gap was reset to the current window.',
					unpublished: 'The unpublished range was reset to the current window.',
				},
			},
			noMatch: 'No alerts match the selected filters.',
			summary: {
				fr: { singular: '{count} avis', plural: '{count} avis' },
				en: { singular: '{count} alert', plural: '{count} alerts' },
			},
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
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type AlertHistoryCopy = (typeof alertHistoryCopy)[Locale];
