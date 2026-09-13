import { serviceComparisonCopy } from '$lib/v1/serviceComparison';
import { defineCopy, type Locale } from '$lib/i18n/copy';
import { articleCopy } from '$lib/components/layout/articleCopy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
	en: {
		kicker: 'ACCOUNTABILITY · DAILY',
		heading: 'Accountability receipt',
		subheading: '// RECEIPT',
		lede: 'Daily reliability, reported service, and the lines and stops with the largest delays.',
		article: articleCopy('en', {
			watermark: 'Receipt',
			tags: ['receipt', 'reliability', 'service', 'accountability'],
			generatedLabel: 'GENERATED',
			selectedLabel: 'FOR',
			sections: (count: number) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		}),
		rail: {
			label: 'Day & contents',
			open: 'Open day controls and contents',
			close: 'Close day controls and contents',
			controls: 'Day',
			toc: 'On this page',
			counterPrefix: 'SEC',
		},
		cards: {
			main: {
				title: 'The receipt',
				subtitle: 'The day’s reliability figures, affected service, and worst readings',
			},
			time: {
				title: 'By time of day',
				subtitle: 'Severe delays across the day’s service periods',
			},
			delivered: {
				title: serviceComparisonCopy.en.section,
				subtitle: serviceComparisonCopy.en.split,
			},
			silent: {
				title: 'Scheduled but never appeared',
				subtitle: 'Lines with scheduled trips that never appeared in the live feed',
			},
		},
		caveatLabel: 'Caveat',
		dateSelectLabel: 'Choose a receipt day',
		controlsLabel: 'Day',
		datePicker: {
			label: 'Receipt day',
			gapReason: 'no receipt',
			scheduleOnlyFlag: 'schedule only',
			emptyReason: 'empty day',
		},
		history: {
			group: 'Browse published receipts',
			previous: 'Previous date',
			next: 'Next date',
			coverage: (first, last) => `Available receipts: ${first}–${last}`,
			selection: (date) => `Showing: ${date}`,
			correction: {
				malformed: 'That date was not valid. Showing the latest receipt.',
				'outside-coverage':
					'That date is outside the retained receipts. Showing the latest receipt.',
				gap: 'That date falls in a publication gap. Showing the latest receipt.',
				unpublished: 'That day was not published. Showing the latest receipt.',
			},
		},
		timeOfDay: {
			heading: 'By time of day',
			severeShare: 'Severe-delay share',
			caveat:
				'The share of readings more than five minutes late in each service period of the selected day, worst first. Small samples vary.',
		},
		stateCuts: {
			heading: serviceComparisonCopy.en.section,
			completenessLabel: serviceComparisonCopy.en.label,
			explainer: serviceComparisonCopy.en.explanation,
			standDown: serviceComparisonCopy.en.unavailable,
			splitLabel: serviceComparisonCopy.en.split,
			delivered: serviceComparisonCopy.en.observed,
			cancelled: serviceComparisonCopy.en.cancelled,
			silent: serviceComparisonCopy.en.shortfall,
		},
		notReported: {
			heading: 'Scheduled but never appeared',
			rowLabel: 'Line',
			scheduled: (n) => `${n} scheduled`,
			viewDetail: (id) => `View line ${id}`,
			shownOfTotal: (shown, total) => `Showing ${shown} of ${total}`,
			caveat:
				'Lines with scheduled trips that never appeared in the live feed on the selected day and were not explicitly cancelled. This list identifies lines, not individual buses.',
		},
		receiptSection: 'The receipt',
		terminalTitle: 'service-receipt',
		terminalTag: 'DAILY',
		issuedLabel: 'For',
		metrics: {
			onTime: 'On-time',
			avgDelay: 'Average delay',
			severe: 'Severe delays',
		},
		countsSection: 'Delay reports and alerts',
		counts: {
			routes: 'Lines with severe reports',
			stops: 'Stops with severe reports',
			alerts: 'Alert message versions',
			vehicles: 'Vehicles',
		},
		worstSection: 'Highest mean delays',
		worst: {
			routeLabel: 'Line with highest mean delay',
			stopLabel: 'Stop with highest mean delay',
			routeDeltaLabel: 'On-time vs network',
			stopDelayLabel: 'Average delay',
		},
		caveat:
			'Headline figures use route-attributed delay predictions; repeated predictions remain repeated observations. Line and stop counts cover severe-delay reports, and alert counts cover recorded message versions. A missing figure is unknown; zero remains zero. Publication does not prove full-day feed coverage.',
		emptyIndex: 'No receipts have been published yet. Check back once the daily build runs.',
		emptyReceipt: 'No receipt was published for this day.',
		units: {
			pct: '%',
			min: ' min',
			pts: ' pts',
		},
		dayVerdict: {
			label: 'Day verdict',
			otp: (otpPct) => `${otpPct} of known-delay predictions were in the on-time band`,
			worst: (name, deltaPts) => `highest mean delay: ${name} (on-time ${deltaPts} vs network)`,
			affected: (lines) =>
				`${lines.toLocaleString('en-CA')} ${lines === 1 ? 'line' : 'lines'} with severe-delay predictions`,
			completeness: (pct) => `non-cancelled / scheduled trip-day ratio: ${pct} (capped at 100%)`,
			completenessStandDown: 'service count comparison not yet available',
			none: 'No overall reading for this day.',
		},
	},
	fr: {
		kicker: 'IMPUTABILITÉ · QUOTIDIEN',
		heading: "Reçu d'imputabilité",
		subheading: '// REÇU',
		lede: 'Un bilan quotidien de la fiabilité, du service signalé et des lignes et arrêts aux retards les plus importants.',
		article: articleCopy('fr', {
			watermark: 'Reçu',
			tags: ['reçu', 'fiabilité', 'service', 'imputabilité'],
			generatedLabel: 'PRODUIT',
			selectedLabel: 'POUR LE',
			sections: (count: number) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		}),
		rail: {
			label: 'Jour et sommaire',
			open: 'Ouvrir le choix du jour et le sommaire',
			close: 'Fermer le choix du jour et le sommaire',
			controls: 'Jour',
			toc: 'Sur cette page',
			counterPrefix: 'SEC',
		},
		cards: {
			main: {
				title: 'Le reçu',
				subtitle: 'Les chiffres de fiabilité du jour, le service touché et les pires lectures',
			},
			time: {
				title: 'Par moment de la journée',
				subtitle: 'Les retards graves selon les périodes de service de la journée',
			},
			delivered: {
				title: serviceComparisonCopy.fr.section,
				subtitle: serviceComparisonCopy.fr.split,
			},
			silent: {
				title: 'Planifiés mais jamais apparus',
				subtitle:
					'Les lignes dont des voyages planifiés ne sont jamais apparus dans le flux en direct',
			},
		},
		caveatLabel: 'Mise en garde',
		dateSelectLabel: 'Choisir une journée',
		controlsLabel: 'Jour',
		datePicker: {
			label: 'Journée du reçu',
			gapReason: 'aucun reçu',
			scheduleOnlyFlag: 'horaire seulement',
			emptyReason: 'journée vide',
		},
		history: {
			group: 'Parcourir les reçus publiés',
			previous: 'Date précédente',
			next: 'Date suivante',
			coverage: (first: string, last: string) => `Reçus disponibles : ${first} au ${last}`,
			selection: (date: string) => `Affichage : ${date}`,
			correction: {
				malformed: 'Cette date n’était pas valide. Affichage du reçu le plus récent.',
				'outside-coverage':
					'Cette date est hors des reçus conservés. Affichage du reçu le plus récent.',
				gap: 'Cette date tombe dans une lacune de publication. Affichage du reçu le plus récent.',
				unpublished: 'Cette journée n’a pas été publiée. Affichage du reçu le plus récent.',
			},
		},
		timeOfDay: {
			heading: 'Par moment de la journée',
			severeShare: 'Part de retards sévères',
			caveat:
				'La part des relevés à plus de cinq minutes de retard par période de service du jour sélectionné, du pire au meilleur. Les petits échantillons varient.',
		},
		stateCuts: {
			heading: serviceComparisonCopy.fr.section,
			completenessLabel: serviceComparisonCopy.fr.label,
			explainer: serviceComparisonCopy.fr.explanation,
			standDown: serviceComparisonCopy.fr.unavailable,
			splitLabel: serviceComparisonCopy.fr.split,
			delivered: serviceComparisonCopy.fr.observed,
			cancelled: serviceComparisonCopy.fr.cancelled,
			silent: serviceComparisonCopy.fr.shortfall,
		},
		notReported: {
			heading: 'Planifiés mais jamais apparus',
			rowLabel: 'Ligne',
			scheduled: (n: number) => `${n} planifiés`,
			viewDetail: (id: string) => `Voir la ligne ${id}`,
			shownOfTotal: (shown: number, total: number) => `Affichage de ${shown} sur ${total}`,
			caveat:
				'Les lignes dont des voyages planifiés ne sont jamais apparus dans le flux en direct le jour sélectionné, sans annulation explicite. Cette liste identifie les lignes, pas les véhicules individuels.',
		},
		receiptSection: 'Le reçu',
		terminalTitle: 'recu-de-service',
		terminalTag: 'QUOTIDIEN',
		issuedLabel: 'Pour le',
		metrics: {
			onTime: 'À l’heure',
			avgDelay: 'Retard moyen',
			severe: 'Retards sévères',
		},
		countsSection: 'Retards signalés et avis',
		counts: {
			routes: 'Lignes avec retards graves',
			stops: 'Arrêts avec retards graves',
			alerts: 'Versions d’avis',
			vehicles: 'Véhicules',
		},
		worstSection: 'Retards moyens les plus élevés',
		worst: {
			routeLabel: 'Ligne au retard moyen maximal',
			stopLabel: 'Arrêt au retard moyen maximal',
			routeDeltaLabel: 'Ponctualité c. réseau',
			stopDelayLabel: 'Retard moyen',
		},
		caveat:
			'Les indicateurs principaux utilisent les prévisions de retard attribuées aux lignes; les prévisions répétées restent des observations répétées. Les décomptes de lignes et d’arrêts couvrent les retards graves signalés; les avis comptent les versions de contenu enregistrées. Une valeur absente est inconnue; zéro reste zéro. La publication ne prouve pas une collecte continue sur la journée.',
		emptyIndex:
			'Aucun reçu n’a encore été publié. Revenez une fois la production quotidienne effectuée.',
		emptyReceipt: 'Aucun reçu n’a été publié pour cette journée.',
		units: {
			pct: '%',
			min: ' min',
			pts: ' pts',
		},
		dayVerdict: {
			label: 'Verdict du jour',
			otp: (otpPct: string) =>
				`${otpPct} des prévisions avec retard connu étaient dans la plage de ponctualité`,
			worst: (name: string, deltaPts: string) =>
				`retard moyen maximal : ${name} (ponctualité ${deltaPts} c. réseau)`,
			affected: (lines: number) =>
				`${lines.toLocaleString('fr-CA')} ${lines === 1 ? 'ligne' : 'lignes'} avec des prévisions de retard grave`,
			completeness: (pct: string) =>
				`rapport jours-trajets non annulés / prévus : ${pct} (plafond de 100 %)`,
			completenessStandDown: 'comparaison des décomptes pas encore disponible',
			none: 'Aucune lecture d’ensemble pour ce jour.',
		},
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type ReceiptCopy = (typeof copy)[Locale];
