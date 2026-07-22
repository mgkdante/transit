// receipt.copy.ts: co-located bilingual copy for the Accountability-receipt surface.
//
// Co-located with AccountabilityReceipt.svelte so the screen owns no inline strings.
// The receipt is a daily "service receipt": the day's headline OTP / avg delay /
// severe share, the counts of affected routes/stops/alerts/vehicles, a rider-impact
// score and the single worst route + worst stop.
//
// Shape: `Record<Locale, ReceiptCopy>` with EN + FR. The FR voice is the canonical
// product voice (mirrors the raw-FR /v1 headers); EN is the parallel translation.
// Provider-agnostic: no STM / Montréal references.

import { defineCopy, type Locale } from '$lib/i18n/copy';
import { articleCopy } from '$lib/components/layout/articleCopy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
	en: {
		kicker: 'ACCOUNTABILITY · DAILY',
		heading: 'Accountability receipt',
		subheading: '// RECEIPT',
		lede: 'One day, one receipt: the headline reliability of the service, the day it covers, and the worst of it, issued daily with nothing hidden.',
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
				title: 'Service delivered',
				subtitle: 'Scheduled service split into delivered, cancelled, and silent outcomes',
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
				'Severe-delay share by time of day, worst first. A trailing-window punctuality proxy, not certified performance; small samples vary.',
		},
		stateCuts: {
			heading: 'Service delivered',
			completenessLabel: 'Scheduled service delivered',
			explainer:
				'Completeness is the share of scheduled trips the network actually ran. A silent trip is scheduled but never appears in the live feed; it is counted as not delivered.',
			standDown: 'No data yet; this reading accrues once scheduled-service coverage is published.',
			splitLabel: 'Scheduled trips, by outcome',
			delivered: 'Delivered',
			cancelled: 'Cancelled',
			silent: 'Silent',
		},
		notReported: {
			heading: 'Scheduled but never appeared',
			rowLabel: 'Line',
			scheduled: (n) => `${n} scheduled`,
			viewDetail: (id) => `View line ${id}`,
			shownOfTotal: (shown, total) => `Showing ${shown} of ${total}`,
			caveat:
				'Lines that were scheduled today yet never appeared in the live feed, silent, not explicitly cancelled. This list is per line, not identifiable buses.',
		},
		receiptSection: 'The receipt',
		terminalTitle: 'service-receipt',
		terminalTag: 'DAILY',
		issuedLabel: 'For',
		metrics: {
			onTime: 'On-time',
			avgDelay: 'Average delay',
			severe: 'Severe delays',
			riderImpact: 'Rider impact',
		},
		countsSection: 'Affected on the day',
		counts: {
			routes: 'Lines',
			stops: 'Stops',
			alerts: 'Alerts',
			vehicles: 'Vehicles',
		},
		worstSection: 'Worst of the day',
		worst: {
			routeLabel: 'Worst line',
			stopLabel: 'Worst stop',
			routeDeltaLabel: 'On-time vs network',
			stopDelayLabel: 'Average delay',
		},
		caveat:
			'A daily summary of observed reliability, not a certified service report. Counts cover entities with a reading on the day; a blank figure means no data, never zero.',
		noData: 'no data',
		emptyIndex: 'No receipts have been published yet. Check back once the daily build runs.',
		emptyReceipt: 'No receipt was published for this day.',
		units: {
			pct: '%',
			min: ' min',
			pts: ' pts',
		},
		dayVerdict: {
			label: 'Day verdict',
			otp: (otpPct) => `The network ran on time ${otpPct} of the time that day`,
			worst: (name, deltaPts) => `worst line ${name} (${deltaPts} lost)`,
			affected: (lines) => `${lines} lines affected`,
			completeness: (pct) => `service delivered at ${pct}`,
			completenessStandDown: 'service completeness not yet available',
			none: 'No overall reading for this day.',
		},
	},
	fr: {
		kicker: 'IMPUTABILITÉ · QUOTIDIEN',
		heading: "Reçu d'imputabilité",
		subheading: '// REÇU',
		lede: 'Un jour, un reçu : la fiabilité globale du service, la journée couverte et le pire de la journée, émis chaque jour, rien de caché.',
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
				title: 'Service livré',
				subtitle: 'Le service planifié réparti entre livré, annulé et silencieux',
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
				'Part de retards sévères par moment de la journée, du pire au meilleur. Un indicateur de ponctualité sur fenêtre glissante, pas une performance certifiée; les petits échantillons varient.',
		},
		stateCuts: {
			heading: 'Service livré',
			completenessLabel: 'Service planifié livré',
			explainer:
				'La complétude est la part des voyages planifiés que le réseau a réellement effectués. Un voyage silencieux est planifié mais n’apparaît jamais dans le flux en direct : il compte comme non livré.',
			standDown:
				'Aucune donnée pour l’instant. Cette mesure s’accumule une fois la couverture du service planifié publiée.',
			splitLabel: 'Voyages planifiés, par issue',
			delivered: 'Livrés',
			cancelled: 'Annulés',
			silent: 'Silencieux',
		},
		notReported: {
			heading: 'Planifiés mais jamais apparus',
			rowLabel: 'Ligne',
			scheduled: (n: number) => `${n} planifiés`,
			viewDetail: (id: string) => `Voir la ligne ${id}`,
			shownOfTotal: (shown: number, total: number) => `Affichage de ${shown} sur ${total}`,
			caveat:
				'Des lignes planifiées aujourd’hui mais jamais apparues dans le flux en direct, silencieuses, pas explicitement annulées. Cette liste porte sur les lignes, pas des véhicules identifiables.',
		},
		receiptSection: 'Le reçu',
		terminalTitle: 'recu-de-service',
		terminalTag: 'QUOTIDIEN',
		issuedLabel: 'Pour le',
		metrics: {
			onTime: 'À l’heure',
			avgDelay: 'Retard moyen',
			severe: 'Retards sévères',
			riderImpact: 'Impact sur la clientèle',
		},
		countsSection: 'Touchés dans la journée',
		counts: {
			routes: 'Lignes',
			stops: 'Arrêts',
			alerts: 'Avis',
			vehicles: 'Véhicules',
		},
		worstSection: 'Le pire de la journée',
		worst: {
			routeLabel: 'Pire ligne',
			stopLabel: 'Pire arrêt',
			routeDeltaLabel: 'Ponctualité c. réseau',
			stopDelayLabel: 'Retard moyen',
		},
		caveat:
			'Un résumé quotidien de la fiabilité observée, et non un rapport de service certifié. Les décomptes portent sur les entités ayant une mesure ce jour-là; une valeur vide signifie aucune donnée, jamais zéro.',
		noData: 'aucune donnée',
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
			otp: (otpPct: string) => `Le réseau a été à l’heure ${otpPct} ce jour-là`,
			worst: (name: string, deltaPts: string) => `pire ligne ${name} (${deltaPts} perdus)`,
			affected: (lines: string) => `${lines} lignes touchées`,
			completeness: (pct: string) => `service assuré à ${pct}`,
			completenessStandDown: 'complétude du service pas encore disponible',
			none: 'Aucune lecture d’ensemble pour ce jour.',
		},
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type ReceiptCopy = (typeof copy)[Locale];
